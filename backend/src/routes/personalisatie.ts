import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireIngelogd } from "../plugins/requireAuth.js";
import { isDag, naarDatum, uitDatum, vandaag } from "../datum.js";
import { bibliotheek, inCatalogus } from "../bibliotheek.js";
import {
  BLESSURES,
  DOELEN,
  ERVARING,
  maakVoorstel,
  MATERIAAL_KEUZES,
  weekdoelen,
  type Blessure,
  type Doel,
  type Ervaring,
  type Voorkeuren,
} from "../generator.js";
import { aanbevolenTempo, haalbaarheid } from "../lichaam.js";
import { valideerProgramma } from "../programmaImport.js";
import { ALLE_SPIER_LABELS } from "../spieren.js";
import { effectiefDoel, huidigGewicht, profiel } from "./lichaam.js";
import { ongeldig } from "./auth.js";

/** De ene rij met voorkeuren; bestaat die nog niet, dan met de standaardwaarden. */
export async function voorkeuren() {
  const bestaand = await prisma.voorkeuren.findUnique({ where: { id: "ik" } });
  if (bestaand) return bestaand;
  try {
    return await prisma.voorkeuren.create({ data: { id: "ik" } });
  } catch {
    // Twee verzoeken tegelijk: de ander was eerst.
    return prisma.voorkeuren.findUniqueOrThrow({ where: { id: "ik" } });
  }
}

const FOCUS_SPIEREN = Object.keys(weekdoelen({ doel: "spiermassa", ervaring: "gevorderd", focus: [] }));

const voorkeurenSchema = z.object({
  doel: z.enum(Object.keys(DOELEN) as [Doel, ...Doel[]]),
  ervaring: z.enum(Object.keys(ERVARING) as [Ervaring, ...Ervaring[]]),
  dagenPerWeek: z.number().int().min(2).max(6),
  minutenPerTraining: z.number().int().min(30).max(120),
  materiaal: z.array(z.enum(Object.keys(MATERIAAL_KEUZES) as [string, ...string[]])).max(20),
  blessures: z.array(z.enum(Object.keys(BLESSURES) as [Blessure, ...Blessure[]])).max(3),
  focus: z.array(z.enum(FOCUS_SPIEREN as [string, ...string[]])).max(3, "Kies hoogstens drie spiergroepen"),
  doelgewicht: z.number().min(30).max(300).nullable().optional(),
  streefdatum: z.string().refine(isDag, "Ongeldige datum").nullable().optional(),
});

function alsVoorkeuren(v: Awaited<ReturnType<typeof voorkeuren>>): Voorkeuren {
  return {
    doel: v.doel as Doel,
    ervaring: v.ervaring as Ervaring,
    dagenPerWeek: v.dagenPerWeek,
    minutenPerTraining: v.minutenPerTraining,
    materiaal: v.materiaal,
    blessures: v.blessures as Blessure[],
    favorieten: v.favorieten,
    uitgesloten: v.uitgesloten,
    focus: v.focus,
  };
}

async function haalbaarheidNu(dag: string) {
  const p = await profiel();
  const doel = await effectiefDoel(p);
  const kg = await huidigGewicht(dag);
  return {
    kg,
    doelgewicht: doel.gewicht,
    streefdatum: p.streefdatum ? uitDatum(p.streefdatum) : null,
    haalbaarheid: kg !== null && doel.gewicht !== null && p.streefdatum ? haalbaarheid(kg, doel.gewicht, uitDatum(p.streefdatum), dag) : null,
    tempo: doel.tempoMin !== null && doel.tempoMax !== null ? ([doel.tempoMin, doel.tempoMax] as [number, number]) : null,
  };
}

export async function personalisatieRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);

  app.get("/api/voorkeuren", async () => {
    const v = await voorkeuren();
    const { perId } = bibliotheek();
    const naam = (id: string) => ({ id, naam: inCatalogus(id)?.naam ?? perId.get(id)?.naam ?? id });
    const lichaam = await haalbaarheidNu(vandaag());
    return {
      voorkeuren: alsVoorkeuren(v),
      favorieten: v.favorieten.map(naam),
      uitgesloten: v.uitgesloten.map(naam),
      keuzes: {
        doelen: DOELEN,
        ervaring: ERVARING,
        blessures: BLESSURES,
        materiaal: MATERIAAL_KEUZES,
        spieren: Object.fromEntries(FOCUS_SPIEREN.map((s) => [s, ALLE_SPIER_LABELS[s] ?? s])),
      },
      lichaam,
    };
  });

  app.put("/api/voorkeuren", async (request, reply) => {
    const parsed = voorkeurenSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const { doelgewicht, streefdatum, ...rest } = parsed.data;
    await voorkeuren();
    await profiel();
    await prisma.$transaction([
      prisma.voorkeuren.update({ where: { id: "ik" }, data: rest }),
      prisma.profiel.update({
        where: { id: "ik" },
        data: {
          ...(doelgewicht !== undefined ? { doelgewicht } : {}),
          ...(streefdatum !== undefined ? { streefdatum: streefdatum ? naarDatum(streefdatum) : null } : {}),
        },
      }),
    ]);
    return { ok: true, lichaam: await haalbaarheidNu(vandaag()) };
  });

  // Een schemavoorstel op basis van je opgeslagen voorkeuren. Er wordt niets opgeslagen: inladen
  // gaat via POST /api/programmas/import met het bestand uit dit antwoord.
  app.post("/api/voorstel", async () => {
    const dag = vandaag();
    const v = await voorkeuren();
    const [oefeningen, gelogd, lichaam, bestaatAl] = await Promise.all([
      prisma.oefening.findMany(),
      prisma.trainingOefening.findMany({ where: { sets: { some: {} } }, select: { oefeningId: true }, distinct: ["oefeningId"] }),
      haalbaarheidNu(dag),
      prisma.programma.findUnique({ where: { sleutel: "op_maat" }, select: { id: true, actief: true } }),
    ]);
    const metGeschiedenis = new Set(gelogd.map((g) => g.oefeningId));
    const { perId } = bibliotheek();
    const voorstel = maakVoorstel({
      voorkeuren: alsVoorkeuren(v),
      bestaand: oefeningen.map((o) => ({
        sleutel: o.sleutel,
        naam: o.naam,
        materiaal: o.materiaal,
        gewichtsstap: o.gewichtsstap,
        perKant: o.perKant,
        spierenPrimair: o.spierenPrimair,
        spierenSecundair: o.spierenSecundair,
        mechaniek: o.mechaniek,
        unilateraal: o.unilateraal,
        knieGevoelig: o.knieGevoelig,
        alternatieven: o.alternatieven,
        bibliotheekId: o.bibliotheekId,
        heeftGeschiedenis: metGeschiedenis.has(o.id),
      })),
      bibliotheekFavorieten: v.favorieten.map((id) => perId.get(id)).filter((o) => o !== undefined),
      dag,
      doelLichaam: {
        startKg: lichaam.kg,
        doelKg: lichaam.doelgewicht,
        tempo: lichaam.tempo ?? (lichaam.kg !== null ? [aanbevolenTempo(lichaam.kg).min, aanbevolenTempo(lichaam.kg).max] : null),
      },
    });
    const controle = valideerProgramma(voorstel.bestand);
    return {
      split: voorstel.split,
      sessies: voorstel.sessies,
      volume: voorstel.volume,
      opmerkingen: voorstel.opmerkingen,
      bestand: voorstel.bestand,
      controle: controle.ok ? { ok: true, waarschuwingen: controle.waarschuwingen } : { ok: false, fouten: controle.fouten },
      lichaam,
      bestaatAl,
    };
  });
}
