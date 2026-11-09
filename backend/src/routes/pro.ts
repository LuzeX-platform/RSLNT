// Pro voor wie serieuzer traint: analyse, advies voor vandaag, blokken, duurtraining,
// pijnlogboek, export en leeslinks. Alles achter requireIngelogd én vereistPro (fail-closed, zie
// entitlementsPro.ts). Wat je zonder Pro gebruikt — trainen, voorstel, voortgang, bibliotheek,
// schema op maat — staat elders en raakt dit niet.

import { createHash, randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";
import { vereistPro } from "../entitlementsPro.js";
import { isDag, naarDatum, uitDatum, vandaag, verschuifDag } from "../datum.js";
import { ongeldig } from "./auth.js";
import { actiefProgramma, alsRegel, blokplanVan, faseVoor, historiePerOefening, volgendeSchema } from "../trainingData.js";
import { bepaalVoorstel } from "../progressie.js";
import { deloadOverwegen, type HerstelWaarden } from "../herstel.js";
import { adviesVoorVandaag } from "../belasting.js";
import { BEEN_SPIEREN, DUUR_SOORT_SLEUTELS, DUUR_SOORTEN, hybrideAdvies, INTENSITEIT_SLEUTELS, INTENSITEITEN } from "../hybride.js";
import { BLOK_SOORTEN, eindeVan, SJABLONEN, totaalWeken, type Blokplan } from "../periodisering.js";
import { dagVan, e1rm, fractioneleSets } from "../voortgang.js";
import { PIJN_PLEK_SLEUTELS, PIJN_PLEKKEN } from "../pijn.js";
import { duurLijst, krachtAnalyse, pijnLogboek } from "../proData.js";
import { appUrl } from "../mailer.js";
import { vertaalWens, WensFout, wensSchema } from "../wensVertalen.js";

export const DEEL_ONDERDELEN = ["trainingen", "kracht", "pijn", "duur"] as const;
const MAX_ACTIEVE_LINKS = 10;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// ---------- CSV ----------
// Puntkomma en een decimale komma, met een BOM: zo opent Excel met Nederlandse instellingen het
// bestand meteen goed. Afgewogen: komma's en punten (de "echte" CSV) — dan zet Excel alles in
// één kolom of maakt van 22.5 een datum.
const csvVeld = (w: unknown) => {
  if (w === null || w === undefined) return "";
  const tekst = typeof w === "number" ? String(w).replace(".", ",") : String(w);
  return /[";\n\r]/.test(tekst) ? `"${tekst.replace(/"/g, '""')}"` : tekst;
};
const csv = (kop: string[], rijen: unknown[][]) => "﻿" + [kop, ...rijen].map((r) => r.map(csvVeld).join(";")).join("\r\n") + "\r\n";

const SOORT_LABEL: Record<string, string> = { normaal: "", drop: "dropset", myo: "myo-reps", restpauze: "rest-pause" };

export async function proRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);
  app.addHook("preHandler", vereistPro);

  // ---------- Je wens in eigen woorden ----------
  // Claude zet de tekst om naar de keuzes van Schema op maat; er wordt niets opgeslagen. Elk
  // verzoek kost geld, dus een eigen, krappe limiet.
  app.post("/api/pro/wens", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (request, reply) => {
    const parsed = wensSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    try {
      return await vertaalWens(parsed.data.tekst);
    } catch (fout) {
      if (!(fout instanceof WensFout)) throw fout;
      request.log.warn({ code: fout.code, reden: fout.message }, "wens vertalen mislukt");
      return reply
        .code(fout.code === "AI_NIET_BESCHIKBAAR" ? 503 : 502)
        .send({ errorCode: fout.code, bericht: fout.code === "AI_NIET_BESCHIKBAAR" ? "Dit kan nu even niet. Vul de keuzes hieronder zelf in." : "Dat lukte niet. Probeer het anders te zeggen, of vul de keuzes zelf in." });
    }
  });

  // ---------- Analyse ----------
  app.get("/api/pro/analyse", async (request) => krachtAnalyse(gid(request)));

  // ---------- Advies voor vandaag ----------
  app.get("/api/pro/vandaag", async (request) => {
    const g = gid(request);
    const dag = vandaag();
    const programma = await actiefProgramma(g);
    const [checks, duur, laatsteDeload] = await Promise.all([
      prisma.herstelcheck.findMany({
        where: { gebruikerId: g, datum: { lte: naarDatum(dag), gte: naarDatum(verschuifDag(dag, -60)) } },
        orderBy: { datum: "desc" },
        take: 30,
      }),
      prisma.duurtraining.findMany({ where: { gebruikerId: g, datum: { gte: naarDatum(verschuifDag(dag, -13)) } } }),
      prisma.training.findFirst({ where: { gebruikerId: g, fase: "deload" }, orderBy: { datum: "desc" }, select: { datum: true } }),
    ]);
    const waarden = (c: HerstelWaarden): HerstelWaarden => ({ slaap: c.slaap, energie: c.energie, spierpijn: c.spierpijn, pijn: c.pijn });
    const vandaagCheck = checks[0] && uitDatum(checks[0].datum) === dag ? waarden(checks[0]) : null;

    // Vastlopen en pijn: het voorstel voor elke oefening uit je actieve programma.
    const stagnerend: string[] = [];
    const pijn: string[] = [];
    let volgende: { naam: string; benenSets: number } | null = null;
    let blok = null;
    let plan: Blokplan | null = null;
    if (programma) {
      const regels = await prisma.schemaOefening.findMany({
        where: { schema: { programmaId: programma.id, inRotatie: true } },
        include: { oefening: true },
      });
      const historie = await historiePerOefening(g, [...new Set(regels.map((r) => r.oefeningId))], { lte: new Date() });
      const gezien = new Set<string>();
      for (const r of regels) {
        if (gezien.has(r.oefeningId)) continue;
        gezien.add(r.oefeningId);
        const v = bepaalVoorstel(r.oefening, r, historie.get(r.oefeningId) ?? [], { regel: alsRegel(r.progressie) });
        if (v.pijnRegel) pijn.push(r.oefening.naam);
        else if (v.actie === "terug") stagnerend.push(r.oefening.naam);
      }
      const schema = await volgendeSchema(programma);
      if (schema) {
        const sets = fractioneleSets(regels.filter((r) => r.schemaId === schema.id).map((r) => ({ ...r.oefening, sets: r.aantalSets })));
        volgende = { naam: schema.naam, benenSets: BEEN_SPIEREN.reduce((som, s) => som + (sets[s] ?? 0), 0) };
      }
      blok = faseVoor(programma, dag, true).blok;
      plan = blokplanVan(programma);
    }
    const sindsDeload = laatsteDeload?.datum ?? programma?.startdatum ?? null;
    const wekenSindsDeload = sindsDeload ? Math.floor((naarDatum(dag).getTime() - naarDatum(dagVan(sindsDeload)).getTime()) / (7 * 86400000)) : null;
    const advies = adviesVoorVandaag({ vandaag: vandaagCheck, checks: checks.map(waarden), stagnerend, pijn, wekenSindsDeload });
    return {
      vandaag: dag,
      ...advies,
      herstelHerhaaldSlecht: deloadOverwegen(checks.map(waarden)),
      hybride: hybrideAdvies(
        duur.map((d) => ({ datum: uitDatum(d.datum), soort: d.soort, minuten: d.minuten, intensiteit: d.intensiteit })),
        dag,
        volgende,
      ),
      blok,
      planEinde: plan ? eindeVan(plan) : null,
    };
  });

  // ---------- Periodisering ----------
  const periodisering = async (g: string) => {
    const programma = await actiefProgramma(g);
    const plan = programma ? blokplanVan(programma) : null;
    const dag = vandaag();
    return {
      programma: programma && { id: programma.id, naam: programma.naam },
      plan: plan && { ...plan, einde: eindeVan(plan), totaalWeken: totaalWeken(plan) },
      blok: programma ? faseVoor(programma, dag, true).blok : null,
      sjablonen: Object.entries(SJABLONEN).map(([doel, s]) => ({ doel, label: s.label, blokken: s.blokken, weken: s.blokken.reduce((a, b) => a + b.weken, 0) })),
      soorten: BLOK_SOORTEN,
      vandaag: dag,
    };
  };
  app.get("/api/pro/periodisering", async (request) => periodisering(gid(request)));

  app.put("/api/pro/periodisering", async (request, reply) => {
    const parsed = z
      .object({ doel: z.enum(["kracht", "spiermassa"]), start: z.string().refine(isDag, "Kies een geldige startdatum") })
      .safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const dag = vandaag();
    if (parsed.data.start < verschuifDag(dag, -6) || parsed.data.start > verschuifDag(dag, 60)) {
      return reply.code(400).send({ errorCode: "ONGELDIGE_DATUM", bericht: "Begin op een dag tussen een week geleden en twee maanden vooruit." });
    }
    const g = gid(request);
    const programma = await actiefProgramma(g);
    if (!programma) return reply.code(409).send({ errorCode: "GEEN_PROGRAMMA", bericht: "Je hebt nog geen actief programma." });
    const plan: Blokplan = { doel: parsed.data.doel, start: parsed.data.start, blokken: SJABLONEN[parsed.data.doel].blokken };
    await prisma.programma.update({ where: { id: programma.id }, data: { periodisering: plan as unknown as Prisma.InputJsonValue } });
    return periodisering(g);
  });

  app.delete("/api/pro/periodisering", async (request) => {
    const g = gid(request);
    // Trainingen bewaren hun eigen blok, dus stoppen herschrijft je geschiedenis niet.
    await prisma.programma.updateMany({ where: { gebruikerId: g, actief: true }, data: { periodisering: Prisma.DbNull } });
    return periodisering(g);
  });

  // ---------- Duurtraining ----------
  app.get<{ Querystring: { dagen?: string } }>("/api/pro/duur", async (request) => {
    const g = gid(request);
    const dagen = Math.min(Math.max(Number(request.query.dagen) || 90, 7), 730);
    const lijst = await duurLijst(g, dagen);
    return {
      vandaag: vandaag(),
      duurtrainingen: lijst,
      week: hybrideAdvies(lijst, vandaag(), null).week,
      soorten: DUUR_SOORTEN,
      intensiteiten: INTENSITEITEN,
    };
  });

  app.post("/api/pro/duur", async (request, reply) => {
    const parsed = z
      .object({
        datum: z.string().refine(isDag, "Kies een geldige datum"),
        soort: z.enum(DUUR_SOORT_SLEUTELS),
        minuten: z.number().int("Hele minuten").min(1, "Minstens 1 minuut").max(1440),
        afstandKm: z.number().min(0).max(1000).nullable().optional(),
        intensiteit: z.enum(INTENSITEIT_SLEUTELS),
        notitie: z.string().trim().max(500).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    if (parsed.data.datum > vandaag()) return reply.code(400).send({ errorCode: "ONGELDIGE_DATUM", bericht: "Een duurtraining in de toekomst kan nog niet." });
    const { afstandKm, datum, ...rest } = parsed.data;
    const rij = await prisma.duurtraining.create({
      data: {
        ...rest,
        notitie: rest.notitie ?? "",
        gebruikerId: gid(request),
        datum: naarDatum(datum),
        // Afstand in hele meters: geen floats in de database (zie hub/CLAUDE.md).
        afstandMeter: afstandKm === null || afstandKm === undefined ? null : Math.round(afstandKm * 1000),
      },
    });
    return { id: rij.id };
  });

  app.delete<{ Params: { id: string } }>("/api/pro/duur/:id", async (request, reply) => {
    const { count } = await prisma.duurtraining.deleteMany({ where: { id: request.params.id, gebruikerId: gid(request) } });
    if (count === 0) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    return { ok: true };
  });

  // ---------- Pijnlogboek ----------
  app.get<{ Querystring: { weken?: string } }>("/api/pro/pijn", async (request) => {
    const weken = Math.min(Math.max(Number(request.query.weken) || 12, 4), 52);
    return { ...(await pijnLogboek(gid(request), weken)), plekLabels: PIJN_PLEKKEN };
  });

  app.post("/api/pro/pijn/notities", async (request, reply) => {
    const parsed = z
      .object({
        datum: z.string().refine(isDag, "Kies een geldige datum"),
        plek: z.enum(PIJN_PLEK_SLEUTELS),
        ernst: z.number().int().min(0).max(10),
        notitie: z.string().trim().max(1000).optional(),
      })
      .safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    if (parsed.data.datum > vandaag()) return reply.code(400).send({ errorCode: "ONGELDIGE_DATUM" });
    const rij = await prisma.pijnnotitie.create({
      data: { ...parsed.data, notitie: parsed.data.notitie ?? "", datum: naarDatum(parsed.data.datum), gebruikerId: gid(request) },
    });
    return { id: rij.id };
  });

  // Niet verwijderen: hersteld of weer actief, en de notitie bijwerken. Zo blijft het verloop staan.
  app.patch<{ Params: { id: string } }>("/api/pro/pijn/notities/:id", async (request, reply) => {
    const parsed = z
      .object({ status: z.enum(["actief", "hersteld"]).optional(), notitie: z.string().trim().max(1000).optional() })
      .safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const { status, notitie } = parsed.data;
    const { count } = await prisma.pijnnotitie.updateMany({
      where: { id: request.params.id, gebruikerId: gid(request) },
      data: {
        ...(notitie !== undefined ? { notitie } : {}),
        ...(status ? { status, herstelOp: status === "hersteld" ? naarDatum(vandaag()) : null } : {}),
      },
    });
    if (count === 0) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    return { ok: true };
  });

  // ---------- Export ----------
  app.get("/api/pro/export/sets.csv", async (request, reply) => {
    const trainingen = await prisma.training.findMany({
      where: { gebruikerId: gid(request) },
      orderBy: { datum: "asc" },
      include: {
        schema: { select: { code: true, naam: true } },
        oefeningen: { orderBy: { volgorde: "asc" }, include: { oefening: { select: { naam: true } }, sets: { orderBy: { nummer: "asc" } } } },
      },
    });
    const rijen = trainingen.flatMap((t) =>
      t.oefeningen.flatMap((o) =>
        o.sets.map((s) => [
          dagVan(t.datum),
          `${t.schema.code} · ${t.schema.naam}`,
          t.fase,
          t.blok ?? "",
          o.oefening.naam,
          s.nummer,
          SOORT_LABEL[s.soort] ?? s.soort,
          s.gewicht,
          s.reps,
          s.rir,
          s.pijn,
          s.pijnPlek ? (PIJN_PLEKKEN[s.pijnPlek as keyof typeof PIJN_PLEKKEN] ?? s.pijnPlek) : "",
          s.soort === "normaal" ? e1rm(s.gewicht, s.reps, s.rir) : null,
        ]),
      ),
    );
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="rslnt-sets-${vandaag()}.csv"`)
      .header("Cache-Control", "no-store")
      .send(
        csv(["Datum", "Training", "Fase", "Blok", "Oefening", "Set", "Techniek", "Gewicht (kg)", "Reps", "RIR", "Pijn (0-10)", "Waar", "Geschatte 1RM (kg)"], rijen),
      );
  });

  app.get("/api/pro/export/duur.csv", async (request, reply) => {
    const lijst = (await duurLijst(gid(request), 3650)).reverse();
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="rslnt-duurtraining-${vandaag()}.csv"`)
      .header("Cache-Control", "no-store")
      .send(
        csv(
          ["Datum", "Soort", "Minuten", "Afstand (km)", "Intensiteit", "Notitie"],
          lijst.map((d) => [
            d.datum,
            DUUR_SOORTEN[d.soort as keyof typeof DUUR_SOORTEN] ?? d.soort,
            d.minuten,
            d.afstandMeter === null ? null : d.afstandMeter / 1000,
            d.intensiteit,
            d.notitie,
          ]),
        ),
      );
  });

  // ---------- Leeslinks voor je trainer of fysio ----------
  const linkVoorApp = (l: { id: string; naam: string; onderdelen: string[]; verlooptOp: Date; ingetrokkenOp: Date | null; laatstBekekenOp: Date | null; aangemaaktOp: Date }) => ({
    id: l.id,
    naam: l.naam,
    onderdelen: l.onderdelen,
    verlooptOp: l.verlooptOp,
    ingetrokkenOp: l.ingetrokkenOp,
    laatstBekekenOp: l.laatstBekekenOp,
    aangemaaktOp: l.aangemaaktOp,
    actief: !l.ingetrokkenOp && l.verlooptOp > new Date(),
  });

  app.get("/api/pro/deellinks", async (request) => {
    const links = await prisma.deellink.findMany({ where: { gebruikerId: gid(request) }, orderBy: { aangemaaktOp: "desc" } });
    return { links: links.map(linkVoorApp) };
  });

  app.post("/api/pro/deellinks", async (request, reply) => {
    const parsed = z
      .object({
        naam: z.string().trim().min(1, "Voor wie is de link?").max(60),
        onderdelen: z.array(z.enum(DEEL_ONDERDELEN)).min(1, "Kies wat je deelt").max(DEEL_ONDERDELEN.length),
        dagen: z.union([z.literal(7), z.literal(30), z.literal(90)]),
      })
      .safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const g = gid(request);
    const actief = await prisma.deellink.count({ where: { gebruikerId: g, ingetrokkenOp: null, verlooptOp: { gt: new Date() } } });
    if (actief >= MAX_ACTIEVE_LINKS) {
      return reply.code(409).send({ errorCode: "TE_VEEL_LINKS", bericht: `Je hebt al ${MAX_ACTIEVE_LINKS} actieve links. Trek er eerst een in.` });
    }
    const token = randomBytes(24).toString("base64url");
    const link = await prisma.deellink.create({
      data: {
        gebruikerId: g,
        tokenHash: hashToken(token),
        naam: parsed.data.naam,
        onderdelen: [...new Set(parsed.data.onderdelen)],
        verlooptOp: new Date(Date.now() + parsed.data.dagen * 86400000),
      },
    });
    // Het token staat in het #-deel: dat stuurt een browser nooit mee naar de server, dus het
    // komt niet in logs of in een Referer terecht. Alleen hier zie je het, één keer.
    return { link: linkVoorApp(link), url: `${appUrl()}/gedeeld.html#${token}` };
  });

  app.post<{ Params: { id: string } }>("/api/pro/deellinks/:id/intrekken", async (request, reply) => {
    const { count } = await prisma.deellink.updateMany({
      where: { id: request.params.id, gebruikerId: gid(request), ingetrokkenOp: null },
      data: { ingetrokkenOp: new Date() },
    });
    if (count === 0) {
      const bestaat = await prisma.deellink.findFirst({ where: { id: request.params.id, gebruikerId: gid(request) } });
      if (!bestaat) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    }
    return { ok: true };
  });
}
