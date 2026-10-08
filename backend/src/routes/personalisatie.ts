import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";
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
import { importeerProgramma, valideerProgramma } from "../programmaImport.js";
import { ALLE_SPIER_LABELS } from "../spieren.js";
import { effectiefDoel, huidigGewicht, profiel } from "./lichaam.js";
import { ongeldig } from "./auth.js";
import { vereistPro } from "../entitlementsPro.js";

/** De ene rij met voorkeuren; bestaat die nog niet, dan met de standaardwaarden. */
export async function voorkeuren(gebruikerId: string) {
  const bestaand = await prisma.voorkeuren.findUnique({ where: { gebruikerId } });
  if (bestaand) return bestaand;
  try {
    return await prisma.voorkeuren.create({ data: { gebruikerId } });
  } catch {
    // Twee verzoeken tegelijk: de ander was eerst.
    return prisma.voorkeuren.findUniqueOrThrow({ where: { gebruikerId } });
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

async function haalbaarheidNu(gebruikerId: string, dag: string) {
  const p = await profiel(gebruikerId);
  const doel = await effectiefDoel(p);
  const kg = await huidigGewicht(gebruikerId, dag);
  return {
    kg,
    doelgewicht: doel.gewicht,
    streefdatum: p.streefdatum ? uitDatum(p.streefdatum) : null,
    haalbaarheid: kg !== null && doel.gewicht !== null && p.streefdatum ? haalbaarheid(kg, doel.gewicht, uitDatum(p.streefdatum), dag) : null,
    tempo: doel.tempoMin !== null && doel.tempoMax !== null ? ([doel.tempoMin, doel.tempoMax] as [number, number]) : null,
  };
}

/** Alles wat de generator van dit account nodig heeft: bestaande oefeningen (met of zonder geschiedenis) en het lichaamsdoel. */
async function generatorInvoer(g: string, v: Voorkeuren, favorieten: string[], dag: string) {
  const [oefeningen, gelogd, lichaam] = await Promise.all([
    prisma.oefening.findMany({ where: { gebruikerId: g } }),
    prisma.trainingOefening.findMany({
      where: { training: { gebruikerId: g }, sets: { some: {} } },
      select: { oefeningId: true },
      distinct: ["oefeningId"],
    }),
    haalbaarheidNu(g, dag),
  ]);
  const metGeschiedenis = new Set(gelogd.map((x) => x.oefeningId));
  const { perId } = bibliotheek();
  return {
    lichaam,
    invoer: {
      voorkeuren: v,
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
      bibliotheekFavorieten: favorieten.map((id) => perId.get(id)).filter((o) => o !== undefined),
      dag,
      doelLichaam: {
        startKg: lichaam.kg,
        doelKg: lichaam.doelgewicht,
        tempo: lichaam.tempo ?? (lichaam.kg !== null ? ([aanbevolenTempo(lichaam.kg).min, aanbevolenTempo(lichaam.kg).max] as [number, number]) : null),
      },
    },
  };
}

/**
 * Het gratis standaardschema: dezelfde generator, met vaste keuzes die voor de meeste mensen in een
 * gewone sportschool passen. Alleen het aantal dagen kies je zelf. Op maat (doel, tijd, materiaal,
 * klachten, favorieten) is Pro.
 */
export const STANDAARD_VOORKEUREN: Omit<Voorkeuren, "dagenPerWeek"> = {
  doel: "spiermassa",
  ervaring: "beginner",
  minutenPerTraining: 60,
  materiaal: ["dumbbell", "barbell", "kabel", "machine", "stang"],
  blessures: [],
  favorieten: [],
  uitgesloten: [],
  focus: [],
};

export async function personalisatieRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);

  app.get("/api/voorkeuren", async (request) => {
    const g = gid(request);
    const v = await voorkeuren(g);
    const { perId } = bibliotheek();
    const naam = (id: string) => ({ id, naam: inCatalogus(id)?.naam ?? perId.get(id)?.naam ?? id });
    const lichaam = await haalbaarheidNu(g, vandaag());
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
    const g = gid(request);
    await voorkeuren(g);
    await profiel(g);
    await prisma.$transaction([
      prisma.voorkeuren.update({ where: { gebruikerId: g }, data: rest }),
      prisma.profiel.update({
        where: { gebruikerId: g },
        data: {
          ...(doelgewicht !== undefined ? { doelgewicht } : {}),
          ...(streefdatum !== undefined ? { streefdatum: streefdatum ? naarDatum(streefdatum) : null } : {}),
        },
      }),
    ]);
    return { ok: true, lichaam: await haalbaarheidNu(g, vandaag()) };
  });

  // Een schemavoorstel op basis van je opgeslagen voorkeuren. Er wordt niets opgeslagen: inladen
  // gaat via POST /api/programmas/import met het bestand uit dit antwoord.
  // Het schema op maat zelf is Pro; je voorkeuren instellen en bekijken (hierboven) niet — zo
  // kan iemand zonder Pro alvast zien wat hij zou instellen, maar niet het voorstel ophalen.
  app.post("/api/voorstel", { preHandler: vereistPro }, async (request) => {
    const g = gid(request);
    const dag = vandaag();
    const v = await voorkeuren(g);
    const [{ lichaam, invoer }, bestaatAl] = await Promise.all([
      generatorInvoer(g, alsVoorkeuren(v), v.favorieten, dag),
      prisma.programma.findUnique({ where: { gebruikerId_sleutel: { gebruikerId: g, sleutel: "op_maat" } }, select: { id: true, actief: true } }),
    ]);
    const voorstel = maakVoorstel(invoer);
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

  // Gratis: een vast standaardschema voor 2, 3 of 4 dagen per week, meteen actief. Zelfde
  // generator als het schema op maat, maar zonder persoonlijke keuzes. Opnieuw kiezen werkt het
  // programma "standaard" bij (andere dagen), zodat er maar één standaardschema is.
  app.post("/api/standaardschema", async (request, reply) => {
    const parsed = z.object({ dagenPerWeek: z.number().int().min(2).max(4) }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const g = gid(request);
    const { invoer } = await generatorInvoer(g, { ...STANDAARD_VOORKEUREN, dagenPerWeek: parsed.data.dagenPerWeek }, [], vandaag());
    const voorstel = maakVoorstel(invoer);
    const programma = voorstel.bestand.program as Record<string, unknown>;
    const bestand = { ...voorstel.bestand, program: { ...programma, id: "standaard", name: `Standaard: ${voorstel.split.naam}` } };
    const controle = valideerProgramma(bestand);
    if (!controle.ok) throw new Error(`Standaardschema klopt niet: ${controle.fouten.join("; ")}`);
    const { id } = await importeerProgramma(prisma, controle.bestand, { activeren: true, gebruikerId: g });
    return { id, naam: controle.bestand.program.name, split: voorstel.split };
  });
}
