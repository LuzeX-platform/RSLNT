// Samen trainen (gratis): één keer samen dezelfde training. Wie uitnodigt kiest een training uit het
// eigen schema en deelt een code of link; tot 5 anderen doen mee en krijgen precies die oefeningen
// als training in hun eigen account, met hun eigen gewichten en voorstellen. Onderweg zie je van
// elkaar alleen je voornaam, bij welke oefening je bent en hoeveel sets klaar zijn: geen gewichten.

import { randomInt } from "node:crypto";
import type { FastifyInstance, FastifyReply } from "fastify";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";
import { heeftPro } from "../entitlementsPro.js";
import { naarDatum, vandaag } from "../datum.js";
import { haalSchema, maakTraining, schemaVoorStart } from "../trainingStart.js";
import { ongeldig } from "./auth.js";

export const MAX_DEELNEMERS = 6;
const GELDIG_UREN = 12;
/** Na afloop nog een dag te bekijken (wie deed wat), daarna niet meer. */
const ZICHTBAAR_UREN = GELDIG_UREN + 24;
// Geen 0/O, 1/I/L: een code wordt voorgelezen of overgetypt.
const TEKENS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE = /^[A-Z0-9]{6}$/;
const SAMEN_SLEUTEL = "samen";

interface SnapshotRegel {
  volgorde: number;
  aantalSets: number;
  minSets: number;
  repsMin: number;
  repsMax: number;
  supersetGroep: string | null;
  rustSeconden: number | null;
  doelRir: number | null;
  cue: string;
  oefening: {
    sleutel: string;
    naam: string;
    materiaal: string;
    gewichtsstap: number;
    perKant: boolean;
    spierenPrimair: string[];
    spierenSecundair: string[];
    mechaniek: string | null;
    unilateraal: boolean;
    knieGevoelig: boolean;
    alternatieven: string[];
    bibliotheekId: string | null;
  };
}

function nieuweCode() {
  return Array.from({ length: 6 }, () => TEKENS[randomInt(TEKENS.length)]).join("");
}

const normaliseer = (code: string) => code.trim().toUpperCase().replace(/[\s-]/g, "");

async function sessieVan(code: string) {
  const c = normaliseer(code);
  if (!CODE.test(c)) return null;
  const sessie = await prisma.samenSessie.findUnique({
    where: { code: c },
    include: { gastheer: { select: { naam: true } }, deelnemers: { orderBy: { aangemaaktOp: "asc" }, include: { gebruiker: { select: { naam: true } } } } },
  });
  if (!sessie || sessie.aangemaaktOp.getTime() < Date.now() - ZICHTBAAR_UREN * 3600_000) return null;
  return sessie;
}
type Sessie = NonNullable<Awaited<ReturnType<typeof sessieVan>>>;

const voornaam = (naam: string) => naam.trim().split(/\s+/)[0] || "Iemand";
const geldig = (s: Sessie) => s.geldigTot.getTime() > Date.now();

/** Per deelnemer: nog niet begonnen, bezig (welke oefening, hoeveel sets) of klaar. */
async function voortgang(s: Sessie) {
  const ids = s.deelnemers.map((d) => d.trainingId).filter((x): x is string => Boolean(x));
  const trainingen = ids.length
    ? await prisma.training.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          gebruikerId: true,
          status: true,
          oefeningen: { orderBy: { volgorde: "asc" }, select: { aantalSets: true, oefening: { select: { naam: true } }, _count: { select: { sets: true } } } },
        },
      })
    : [];
  return s.deelnemers.map((d) => {
    // Alleen een training van die deelnemer zelf telt (een verwijderde of vreemde id niet).
    const t = trainingen.find((x) => x.id === d.trainingId && x.gebruikerId === d.gebruikerId);
    const totaal = t?.oefeningen.reduce((som, o) => som + o.aantalSets, 0) ?? 0;
    const gedaan = t?.oefeningen.reduce((som, o) => som + Math.min(o._count.sets, o.aantalSets), 0) ?? 0;
    const nu = t?.status === "bezig" ? (t.oefeningen.find((o) => o._count.sets < o.aantalSets)?.oefening.naam ?? null) : null;
    return {
      gebruikerId: d.gebruikerId,
      naam: voornaam(d.gebruiker.naam),
      gastheer: d.gebruikerId === s.gastheerId,
      status: !t ? "wacht" : t.status === "afgerond" ? "klaar" : "bezig",
      setsGedaan: gedaan,
      setsTotaal: totaal,
      nu,
    };
  });
}

async function weergave(s: Sessie, g: string) {
  const ik = s.deelnemers.find((d) => d.gebruikerId === g);
  const regels = s.oefeningen as unknown as SnapshotRegel[];
  const lijst = ik ? await voortgang(s) : [];
  return {
    code: s.code,
    naam: s.naam,
    minuten: s.minuten,
    gastheer: voornaam(s.gastheer.naam),
    ikGastheer: s.gastheerId === g,
    geldig: geldig(s),
    geldigTot: s.geldigTot,
    vol: s.deelnemers.length >= MAX_DEELNEMERS,
    aantal: s.deelnemers.length,
    oefeningen: regels.map((r) => ({ naam: r.oefening.naam, sets: r.aantalSets, reps: r.repsMin === r.repsMax ? `${r.repsMin}` : `${r.repsMin}–${r.repsMax}` })),
    doetMee: Boolean(ik),
    mijnTrainingId: ik?.trainingId ?? null,
    // Alleen wie meedoet ziet wie er nog meer meedoet.
    deelnemers: lijst.map(({ gebruikerId, ...rest }) => ({ ...rest, ikzelf: gebruikerId === g })),
  };
}

/** Jouw oefening voor die van de ander: zelfde sleutel, bibliotheek-id of naam, of een kopie. */
async function oefeningBij(tx: Prisma.TransactionClient, gebruikerId: string, o: SnapshotRegel["oefening"]) {
  const bestaand =
    (await tx.oefening.findUnique({ where: { gebruikerId_sleutel: { gebruikerId, sleutel: o.sleutel } } })) ??
    (o.bibliotheekId ? await tx.oefening.findFirst({ where: { gebruikerId, bibliotheekId: o.bibliotheekId } }) : null) ??
    (await tx.oefening.findFirst({ where: { gebruikerId, naam: { equals: o.naam, mode: "insensitive" } } }));
  return bestaand ?? tx.oefening.create({ data: { gebruikerId, ...o } });
}

/** Voor wie meedoet: de training als schema in een verborgen programma "Samen trainen". */
async function schemaVoorDeelnemer(g: string, s: Sessie) {
  const regels = s.oefeningen as unknown as SnapshotRegel[];
  const schemaId = await prisma.$transaction(async (tx) => {
    const programma =
      (await tx.programma.findUnique({ where: { gebruikerId_sleutel: { gebruikerId: g, sleutel: SAMEN_SLEUTEL } } })) ??
      (await tx.programma.create({ data: { gebruikerId: g, sleutel: SAMEN_SLEUTEL, naam: "Samen trainen", actief: false, startdatum: naarDatum(vandaag()) } }));
    const code = `S-${s.code}`;
    const oud = await tx.schema.findUnique({ where: { programmaId_code: { programmaId: programma.id, code } } });
    if (oud) return oud.id;
    const oefeningIds: string[] = [];
    for (const r of regels) oefeningIds.push((await oefeningBij(tx, g, r.oefening)).id);
    const schema = await tx.schema.create({
      data: {
        programmaId: programma.id,
        code,
        naam: `${s.naam} (samen met ${voornaam(s.gastheer.naam)})`,
        volgorde: 999,
        minuten: s.minuten,
        inRotatie: false,
        oefeningen: {
          create: regels.map((r, i) => ({
            oefeningId: oefeningIds[i],
            volgorde: r.volgorde,
            aantalSets: r.aantalSets,
            minSets: r.minSets,
            repsMin: r.repsMin,
            repsMax: r.repsMax,
            supersetGroep: r.supersetGroep,
            rustSeconden: r.rustSeconden,
            doelRir: r.doelRir,
            cue: r.cue,
          })),
        },
      },
    });
    return schema.id;
  });
  return prisma.schema.findUniqueOrThrow({ where: { id: schemaId }, include: schemaVoorStart });
}

const nietGevonden = (reply: FastifyReply) =>
  reply.code(404).send({ errorCode: "NIET_GEVONDEN", bericht: "Deze code kennen we niet, of hij is verlopen. Vraag om een nieuwe." });

export async function samenRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);
  // Codes zijn kort: raden moet onbegonnen werk blijven.
  const opCode = { config: { rateLimit: { max: 60, timeWindow: "15 minutes" } } };

  // Uitnodigen: een training uit je eigen schema.
  app.post("/api/samen", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (request, reply) => {
    const parsed = z.object({ schemaId: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const g = gid(request);
    const schema = await prisma.schema.findFirst({
      where: { id: parsed.data.schemaId, programma: { gebruikerId: g } },
      include: { oefeningen: { orderBy: { volgorde: "asc" }, include: { oefening: true } } },
    });
    if (!schema) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    if (schema.oefeningen.length === 0) return reply.code(400).send({ errorCode: "SCHEMA_LEEG" });
    const snapshot: SnapshotRegel[] = schema.oefeningen.map((r) => ({
      volgorde: r.volgorde,
      aantalSets: r.aantalSets,
      minSets: r.minSets,
      repsMin: r.repsMin,
      repsMax: r.repsMax,
      supersetGroep: r.supersetGroep,
      rustSeconden: r.rustSeconden,
      doelRir: r.doelRir,
      cue: r.cue,
      oefening: {
        sleutel: r.oefening.sleutel,
        naam: r.oefening.naam,
        materiaal: r.oefening.materiaal,
        gewichtsstap: r.oefening.gewichtsstap,
        perKant: r.oefening.perKant,
        spierenPrimair: r.oefening.spierenPrimair,
        spierenSecundair: r.oefening.spierenSecundair,
        mechaniek: r.oefening.mechaniek,
        unilateraal: r.oefening.unilateraal,
        knieGevoelig: r.oefening.knieGevoelig,
        alternatieven: r.oefening.alternatieven,
        bibliotheekId: r.oefening.bibliotheekId,
      },
    }));
    for (let poging = 0; poging < 5; poging++) {
      const code = nieuweCode();
      try {
        await prisma.samenSessie.create({
          data: {
            code,
            gastheerId: g,
            schemaId: schema.id,
            naam: schema.naam,
            minuten: schema.minuten,
            oefeningen: snapshot as unknown as Prisma.InputJsonValue,
            geldigTot: new Date(Date.now() + GELDIG_UREN * 3600_000),
            deelnemers: { create: { gebruikerId: g } },
          },
        });
        return { code };
      } catch (f) {
        if ((f as { code?: string }).code !== "P2002") throw f; // code bestond al: opnieuw
      }
    }
    throw new Error("Geen vrije code gevonden");
  });

  // Je lopende samen-training (voor Vandaag): meegedaan, nog geldig, nog niet klaar.
  app.get("/api/samen/actief", async (request) => {
    const g = gid(request);
    const rijen = await prisma.samenDeelnemer.findMany({
      where: { gebruikerId: g, sessie: { geldigTot: { gt: new Date() } } },
      orderBy: { aangemaaktOp: "desc" },
      take: 3,
      select: { trainingId: true, sessie: { select: { code: true } } },
    });
    for (const r of rijen) {
      const training = r.trainingId ? await prisma.training.findFirst({ where: { id: r.trainingId, gebruikerId: g }, select: { status: true } }) : null;
      if (training?.status === "afgerond") continue;
      const s = await sessieVan(r.sessie.code);
      if (s) return { samen: await weergave(s, g) };
    }
    return { samen: null };
  });

  // Op het trainingsscherm: met wie je deze training samen doet.
  app.get<{ Params: { id: string } }>("/api/samen/training/:id", async (request, reply) => {
    const g = gid(request);
    const rij = await prisma.samenDeelnemer.findFirst({ where: { gebruikerId: g, trainingId: request.params.id }, select: { sessie: { select: { code: true } } } });
    const s = rij && (await sessieVan(rij.sessie.code));
    if (!s) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    return weergave(s, g);
  });

  app.get<{ Params: { code: string } }>("/api/samen/:code", opCode, async (request, reply) => {
    const s = await sessieVan(request.params.code);
    if (!s) return nietGevonden(reply);
    return weergave(s, gid(request));
  });

  app.post<{ Params: { code: string } }>("/api/samen/:code/doe-mee", opCode, async (request, reply) => {
    const s = await sessieVan(request.params.code);
    if (!s || !geldig(s)) return nietGevonden(reply);
    const g = gid(request);
    if (s.deelnemers.some((d) => d.gebruikerId === g)) return { ok: true };
    if (s.deelnemers.length >= MAX_DEELNEMERS) {
      return reply.code(409).send({ errorCode: "VOL", bericht: `Er doen al ${MAX_DEELNEMERS} mensen mee.` });
    }
    await prisma.samenDeelnemer.create({ data: { sessieId: s.id, gebruikerId: g } }).catch((f) => {
      if (f.code !== "P2002") throw f;
    });
    return { ok: true };
  });

  // Start: wie uitnodigde traint het eigen schema, wie meedoet een kopie in het eigen account.
  app.post<{ Params: { code: string } }>("/api/samen/:code/start", async (request, reply) => {
    const s = await sessieVan(request.params.code);
    if (!s || !geldig(s)) return nietGevonden(reply);
    const g = gid(request);
    const ik = s.deelnemers.find((d) => d.gebruikerId === g);
    if (!ik) return reply.code(403).send({ errorCode: "DOET_NIET_MEE" });
    if (ik.trainingId) {
      const bestaand = await prisma.training.findFirst({ where: { id: ik.trainingId, gebruikerId: g }, select: { id: true } });
      if (bestaand) return { id: bestaand.id };
    }
    const bezig = await prisma.training.findFirst({ where: { gebruikerId: g, status: "bezig" }, select: { id: true } });
    if (bezig) {
      return reply.code(409).send({ errorCode: "TRAINING_BEZIG", id: bezig.id, bericht: "Je hebt nog een training open. Rond die eerst af." });
    }
    const eigen = s.gastheerId === g ? await haalSchema(s.schemaId, g) : null;
    const schema = eigen && eigen.oefeningen.length ? eigen : await schemaVoorDeelnemer(g, s);
    const training = await maakTraining(g, schema, await heeftPro(g));
    await prisma.samenDeelnemer.update({ where: { id: ik.id }, data: { trainingId: training.id } });
    return training;
  });

  // Wie uitnodigde stopt de uitnodiging voor iedereen; wie meedoet stapt alleen zelf uit. Gelogde
  // trainingen blijven altijd staan.
  app.delete<{ Params: { code: string } }>("/api/samen/:code", async (request, reply) => {
    const s = await sessieVan(request.params.code);
    if (!s) return nietGevonden(reply);
    const g = gid(request);
    if (s.gastheerId === g) await prisma.samenSessie.delete({ where: { id: s.id } });
    else await prisma.samenDeelnemer.deleteMany({ where: { sessieId: s.id, gebruikerId: g } });
    return { ok: true };
  });
}
