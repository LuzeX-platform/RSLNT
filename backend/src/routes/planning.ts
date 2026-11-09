// De weekplanner (welke training op welke dag) en je agenda-abonnement. Gratis: plannen hoort bij
// de basis. De agendalink werkt zonder inloggen, alleen met het geheime token in de link; daarom
// staat alleen de hash in de database en logt de server die route niet.

import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";
import { vandaag, verschuifDag } from "../datum.js";
import { actiefProgramma } from "../trainingData.js";
import { maakAgenda } from "../agenda.js";
import { maandagVan, TIJD, WEEKDAGEN } from "../planning.js";
import { zorgVoorPlanning } from "../programmaImport.js";
import { dagVan } from "../voortgang.js";
import { appUrl } from "../mailer.js";
import { hashToken } from "./pro.js";
import { duurDezeWeek, duurSessies, krachtDagen } from "../duurData.js";
import { ongeldig } from "./auth.js";

/** Sets × reps per oefening, voor in de agenda. */
async function agendaTrainingen(gebruikerId: string) {
  const programma = await actiefProgramma(gebruikerId);
  if (!programma) return [];
  const ids = programma.schemas.map((x) => x.id);
  const planning = await prisma.planning.findMany({
    where: { gebruikerId, schemaId: { in: ids } },
    include: { schema: { include: { oefeningen: { orderBy: { volgorde: "asc" }, include: { oefening: { select: { naam: true } } } } } } },
  });
  return planning.map((p) => ({
    weekdag: p.weekdag,
    tijd: p.tijd,
    schemaId: p.schemaId,
    naam: p.schema.naam,
    minuten: p.schema.minuten ?? 60,
    oefeningen: p.schema.oefeningen.map((r) => `${r.oefening.naam}: ${r.aantalSets} × ${r.repsMin}–${r.repsMax}`),
  }));
}

/** De duursessies van deze en de komende 7 weken, als losse afspraken. */
async function agendaDuur(gebruikerId: string, dag: string) {
  const rij = await prisma.duurschema.findUnique({ where: { gebruikerId } });
  if (!rij) return [];
  const { benen } = await krachtDagen(gebruikerId);
  return duurSessies(rij, maandagVan(dag), 8, benen).map((d) => ({
    datum: d.datum,
    tijd: rij.tijd,
    titel: d.sessie.titel,
    minuten: d.sessie.minuten,
    uitleg: `Week ${d.week}. ${d.sessie.uitleg}`,
  }));
}

export function agendaUrls(token: string) {
  const https = `${appUrl()}/api/agenda/${token}.ics`;
  return { https, webcal: https.replace(/^https?:\/\//, "webcal://") };
}

export async function planningRoutes(app: FastifyInstance) {
  // ---------- Het agenda-abonnement (zonder inloggen) ----------
  app.get<{ Params: { bestand: string } }>(
    "/api/agenda/:bestand",
    // Het token staat in de URL (een agenda-app kan niets anders): niet in de logs zetten.
    { logLevel: "silent", config: { rateLimit: { max: 60, timeWindow: "15 minutes" } } },
    async (request, reply) => {
      const token = /^([A-Za-z0-9_-]{20,100})\.ics$/.exec(request.params.bestand)?.[1];
      const gebruiker = token ? await prisma.gebruiker.findUnique({ where: { agendaTokenHash: hashToken(token) }, select: { id: true } }) : null;
      if (!gebruiker) return reply.code(404).send({ errorCode: "LINK_ONGELDIG" });
      const dag = vandaag();
      const [trainingen, duur] = await Promise.all([agendaTrainingen(gebruiker.id), agendaDuur(gebruiker.id, dag)]);
      const tekst = maakAgenda(trainingen, { dag, nu: new Date(), appUrl: appUrl(), duur });
      return reply
        .header("Content-Type", "text/calendar; charset=utf-8")
        .header("Content-Disposition", 'inline; filename="rslnt.ics"')
        .header("Cache-Control", "no-store")
        .send(tekst);
    },
  );

  // ---------- Alles hieronder: ingelogd ----------
  await app.register(async (ingelogd) => {
    ingelogd.addHook("preHandler", requireIngelogd);

    ingelogd.get("/api/planning", async (request) => {
      const g = gid(request);
      const dag = vandaag();
      const programma = await actiefProgramma(g);
      const maandag = maandagVan(dag);
      const [planning, deezeWeek, gebruiker, duur] = await Promise.all([
        programma ? prisma.planning.findMany({ where: { gebruikerId: g, schemaId: { in: programma.schemas.map((x) => x.id) } } }) : [],
        prisma.training.findMany({
          where: { gebruikerId: g, datum: { gte: new Date(new Date(`${maandag}T00:00:00Z`).getTime() - 2 * 3600_000) } },
          select: { datum: true, status: true, schema: { select: { naam: true } } },
        }),
        prisma.gebruiker.findUniqueOrThrow({ where: { id: g }, select: { agendaTokenHash: true } }),
        duurDezeWeek(g, dag),
      ]);
      const schemas = programma?.schemas ?? [];
      return {
        vandaag: dag,
        programma: programma && { id: programma.id, naam: programma.naam },
        schemas: schemas.map((x) => ({ id: x.id, code: x.code, naam: x.naam, minuten: x.minuten })),
        dagen: WEEKDAGEN.map((naam, i) => {
          const weekdag = i + 1;
          const datum = verschuifDag(maandag, i);
          const p = planning.find((x) => x.weekdag === weekdag);
          const schema = p && schemas.find((x) => x.id === p.schemaId);
          return {
            weekdag,
            naam,
            datum,
            schemaId: schema?.id ?? null,
            training: schema?.naam ?? null,
            tijd: p?.tijd ?? "18:00",
            duur: (() => {
              const d = duur?.sessies.find((x) => x.datum === datum);
              return d ? { titel: d.sessie.titel, sport: d.sessie.sport, minuten: d.sessie.minuten, rol: d.sessie.rol, tijd: duur!.rij.tijd, gedaan: d.gedaan } : null;
            })(),
            gedaan: deezeWeek.filter((t) => dagVan(t.datum) === datum).map((t) => ({ naam: t.schema.naam, afgerond: t.status === "afgerond" })),
          };
        }),
        agenda: { actief: gebruiker.agendaTokenHash !== null },
        duurschema: duur !== null,
      };
    });

    // Eén dag instellen: een training (en tijd), of rust (schemaId null).
    ingelogd.put<{ Params: { weekdag: string } }>("/api/planning/:weekdag", async (request, reply) => {
      const weekdag = Number(request.params.weekdag);
      if (!Number.isInteger(weekdag) || weekdag < 1 || weekdag > 7) return reply.code(400).send({ errorCode: "ONGELDIGE_DAG" });
      const parsed = z
        .object({ schemaId: z.string().min(1).nullable(), tijd: z.string().regex(TIJD, "Tijd als 18:00").optional() })
        .safeParse(request.body);
      if (!parsed.success) return ongeldig(reply, parsed.error);
      const g = gid(request);
      const sleutel = { gebruikerId_weekdag: { gebruikerId: g, weekdag } };
      if (parsed.data.schemaId === null) {
        await prisma.planning.deleteMany({ where: { gebruikerId: g, weekdag } });
        return { ok: true };
      }
      // Alleen een training uit je eigen, actieve programma.
      const programma = await actiefProgramma(g);
      if (!programma?.schemas.some((x) => x.id === parsed.data.schemaId)) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
      const tijd = parsed.data.tijd ?? "18:00";
      await prisma.planning.upsert({
        where: sleutel,
        update: { schemaId: parsed.data.schemaId, ...(parsed.data.tijd ? { tijd } : {}) },
        create: { gebruikerId: g, weekdag, schemaId: parsed.data.schemaId, tijd },
      });
      return { ok: true };
    });

    // Opnieuw verdelen over de week (ook voor wie nog geen planning had).
    ingelogd.post("/api/planning/standaard", async (request, reply) => {
      const g = gid(request);
      const programma = await actiefProgramma(g);
      if (!programma) return reply.code(409).send({ errorCode: "GEEN_PROGRAMMA" });
      await prisma.$transaction(async (tx) => {
        await tx.planning.deleteMany({ where: { gebruikerId: g } });
        await zorgVoorPlanning(tx, g, programma.id);
      });
      return { ok: true };
    });

    // Een (nieuwe) agendalink. Een oude link werkt daarna niet meer.
    ingelogd.post("/api/agenda", async (request) => {
      const token = randomBytes(24).toString("base64url");
      await prisma.gebruiker.update({ where: { id: gid(request) }, data: { agendaTokenHash: hashToken(token) } });
      return agendaUrls(token);
    });

    ingelogd.delete("/api/agenda", async (request) => {
      await prisma.gebruiker.update({ where: { id: gid(request) }, data: { agendaTokenHash: null } });
      return { ok: true };
    });
  });
}
