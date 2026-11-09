// Database rond het duursportschema: je keuzes ophalen, de sessies per week berekenen
// (duurschema.ts), ze op je dagen zetten met je benentrainingen in gedachten, en zien wat je al deed.

import type { Duurschema as DuurschemaRij } from "@prisma/client";
import { prisma } from "./db.js";
import { naarDatum, uitDatum, verschuifDag } from "./datum.js";
import { maakDuurschema, verdeelOverWeek, weekUitSchema, type DuurInstellingen, type DuurSessieVoorstel, type DuurSport, type DuurDoel, type DuurNiveau } from "./duurschema.js";
import { maandagVan, weekdagVan } from "./planning.js";
import { fractioneleSets } from "./voortgang.js";
import { BEEN_SPIEREN, BENEN_SETS } from "./hybride.js";
import { actiefProgramma } from "./trainingData.js";

export function instellingenVan(r: Pick<DuurschemaRij, "sport" | "doel" | "afstand" | "niveau" | "dagenPerWeek">): DuurInstellingen {
  return { sport: r.sport as DuurSport, doel: r.doel as DuurDoel, afstand: r.afstand, niveau: r.niveau as DuurNiveau, dagenPerWeek: r.dagenPerWeek };
}

/** Je krachtdagen uit de weekplanner, en welke daarvan zwaar zijn voor je benen. */
export async function krachtDagen(gebruikerId: string): Promise<{ alle: number[]; benen: number[] }> {
  const programma = await actiefProgramma(gebruikerId);
  if (!programma) return { alle: [], benen: [] };
  const planning = await prisma.planning.findMany({
    where: { gebruikerId, schemaId: { in: programma.schemas.map((x) => x.id) } },
    include: { schema: { include: { oefeningen: { include: { oefening: { select: { spierenPrimair: true, spierenSecundair: true } } } } } } },
  });
  const benen = planning
    .filter((p) => {
      const sets = fractioneleSets(p.schema.oefeningen.map((r) => ({ spierenPrimair: r.oefening.spierenPrimair, spierenSecundair: r.oefening.spierenSecundair, sets: r.aantalSets })));
      return BEEN_SPIEREN.reduce((som, m) => som + (sets[m] ?? 0), 0) >= BENEN_SETS;
    })
    .map((p) => p.weekdag);
  return { alle: planning.map((p) => p.weekdag), benen };
}

export interface DuurOpDag {
  datum: string;
  weekdag: number;
  week: number;
  sessie: DuurSessieVoorstel;
}

/** De duursessies per dag, voor de weken die je vraagt (vanaf een maandag). */
export function duurSessies(rij: DuurschemaRij, maandag: string, weken: number, benenDagen: number[]): DuurOpDag[] {
  const schema = maakDuurschema(instellingenVan(rij));
  const start = uitDatum(rij.startdatum);
  const uit: DuurOpDag[] = [];
  for (let k = 0; k < weken; k++) {
    const weekMaandag = verschuifDag(maandag, 7 * k);
    const week = Math.round((naarDatum(weekMaandag).getTime() - naarDatum(start).getTime()) / (7 * 86400000)) + 1;
    const w = weekUitSchema(schema, week);
    if (!w) continue;
    for (const [weekdag, sessie] of verdeelOverWeek(w.sessies, rij.dagen, benenDagen)) {
      uit.push({ datum: verschuifDag(weekMaandag, weekdag - 1), weekdag, week, sessie });
    }
  }
  return uit.sort((a, b) => a.datum.localeCompare(b.datum));
}

/** Deze week: per duurdag de sessie, en of je die al gedaan hebt (een duurtraining van die sport die dag). */
export async function duurDezeWeek(gebruikerId: string, dag: string) {
  const rij = await prisma.duurschema.findUnique({ where: { gebruikerId } });
  if (!rij) return null;
  const maandag = maandagVan(dag);
  const { benen } = await krachtDagen(gebruikerId);
  const sessies = duurSessies(rij, maandag, 1, benen);
  const gelogd = await prisma.duurtraining.findMany({
    where: { gebruikerId, datum: { gte: naarDatum(maandag), lte: naarDatum(verschuifDag(maandag, 6)) } },
    select: { datum: true, soort: true },
  });
  const gedaan = (d: DuurOpDag) => gelogd.some((g) => uitDatum(g.datum) === d.datum && g.soort === d.sessie.sport);
  return { rij, sessies: sessies.map((d) => ({ ...d, gedaan: gedaan(d) })) };
}

/** Voor Vandaag: de duursessie van vandaag, of null. */
export async function duurVandaag(gebruikerId: string, dag: string) {
  const week = await duurDezeWeek(gebruikerId, dag);
  const vandaag = week?.sessies.find((d) => d.datum === dag);
  return vandaag ? { ...vandaag, tijd: week!.rij.tijd } : null;
}

export { weekdagVan };
