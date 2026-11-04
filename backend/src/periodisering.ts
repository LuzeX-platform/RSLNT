// Pure logica (Pro): periodisering in blokken. Een blokplan verdeelt de komende weken in blokken
// met elk een eigen doel; per blok verandert het doel per oefening (sets, reps, RIR). Het gewicht
// verandert hier nooit: dat doet progressie.ts, met dezelfde vangrails (pijn, max. één stap).
// Zie Wetenschap, #periodisering.
//
// Afgewogen: dagelijkse golfperiodisering (elke training een andere range). Even effectief in
// onderzoek, maar lastiger te volgen in de sportschool en botst met dubbele progressie, die een
// vaste range per oefening nodig heeft. Blokken houden de range per blok gelijk.

import { verschuifDag } from "./datum.js";
import { programmaWeek } from "./fase.js";

export const BLOK_SOORTEN = {
  opbouw: { label: "Opbouw", uitleg: "Zelfde sets en reps, één rep meer over. Wennen aan het blok en techniek scherp krijgen." },
  volume: { label: "Volume", uitleg: "Eén set extra per oefening. Meer werk voor spiergroei, met je gewone RIR." },
  intensivering: {
    label: "Intensivering",
    uitleg: "Bij de basisoefeningen minder reps met meer gewicht en wat dichter bij falen. Isolatie blijft gelijk.",
  },
  piek: { label: "Piek", uitleg: "Basisoefeningen 2–4 reps, een set minder. Zwaar en kort, om je kracht te laten zien." },
  deload: { label: "Deload", uitleg: "Halve sets, zelfde gewicht. Vermoeidheid kwijt voor het volgende blok of je test." },
} as const;
export type BlokSoort = keyof typeof BLOK_SOORTEN;
export const BLOK_SOORT_SLEUTELS = Object.keys(BLOK_SOORTEN) as [BlokSoort, ...BlokSoort[]];

export type PlanDoel = "kracht" | "spiermassa";

export const SJABLONEN: Record<PlanDoel, { label: string; blokken: { soort: BlokSoort; weken: number }[] }> = {
  kracht: {
    label: "Kracht, met een piek",
    blokken: [
      { soort: "opbouw", weken: 3 },
      { soort: "intensivering", weken: 3 },
      { soort: "piek", weken: 2 },
      { soort: "deload", weken: 1 },
    ],
  },
  spiermassa: {
    label: "Spiermassa",
    blokken: [
      { soort: "opbouw", weken: 2 },
      { soort: "volume", weken: 4 },
      { soort: "deload", weken: 1 },
    ],
  },
};

export interface Blokplan {
  doel: PlanDoel;
  /** JJJJ-MM-DD, de eerste dag van week 1 van het plan. */
  start: string;
  blokken: { soort: BlokSoort; weken: number }[];
}

export interface BlokOpDag {
  soort: BlokSoort;
  label: string;
  /** 1-based */
  blokNummer: number;
  weekInBlok: number;
  wekenInBlok: number;
  /** Week van het plan, 1-based. */
  week: number;
  totaalWeken: number;
  /** De laatste dag van het plan (JJJJ-MM-DD). */
  einde: string;
}

export function totaalWeken(plan: Blokplan): number {
  return plan.blokken.reduce((som, b) => som + b.weken, 0);
}

export function eindeVan(plan: Blokplan): string {
  return verschuifDag(plan.start, totaalWeken(plan) * 7 - 1);
}

/** Het blok op een dag; null vóór de start en na het einde van het plan. */
export function blokOp(plan: Blokplan | null, dag: string): BlokOpDag | null {
  if (!plan || dag < plan.start || dag > eindeVan(plan)) return null;
  const week = programmaWeek(plan.start, dag);
  let tot = 0;
  for (const [i, b] of plan.blokken.entries()) {
    if (week <= tot + b.weken) {
      return {
        soort: b.soort,
        label: BLOK_SOORTEN[b.soort].label,
        blokNummer: i + 1,
        weekInBlok: week - tot,
        wekenInBlok: b.weken,
        week,
        totaalWeken: totaalWeken(plan),
        einde: eindeVan(plan),
      };
    }
    tot += b.weken;
  }
  return null;
}

export interface BlokRegel {
  aantalSets: number;
  minSets: number;
  repsMin: number;
  repsMax: number;
  doelRir: number | null;
}

/**
 * Het doel van één oefening in een blok. Deload staat hier niet: dat is de deloadfase (fase.ts),
 * zodat een deload overal hetzelfde betekent. `basisoefening` = mechaniek compound.
 */
export function doelInBlok(regel: BlokRegel, soort: BlokSoort, basisoefening: boolean): BlokRegel {
  const rir = regel.doelRir ?? 2;
  switch (soort) {
    case "opbouw":
      return { ...regel, doelRir: Math.min(4, rir + 1) };
    case "volume": {
      const aantalSets = Math.min(10, regel.aantalSets + 1);
      return { ...regel, aantalSets };
    }
    case "intensivering": {
      if (!basisoefening) return regel;
      const repsMin = Math.max(3, Math.round(regel.repsMin * 0.6));
      const repsMax = Math.max(repsMin + 1, Math.round(regel.repsMax * 0.65));
      return { ...regel, repsMin, repsMax, doelRir: Math.max(1, rir - 1) };
    }
    case "piek": {
      const aantalSets = Math.max(basisoefening ? 2 : 1, regel.aantalSets - 1);
      const minSets = Math.min(regel.minSets, aantalSets);
      if (!basisoefening) return { ...regel, aantalSets, minSets };
      return { aantalSets, minSets, repsMin: 2, repsMax: 4, doelRir: 1 };
    }
    default:
      return regel;
  }
}
