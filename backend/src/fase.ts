// Pure logica: in welke fase van het programma een training valt, en wat dat met het doel doet.
//   * Introfase (eerste weken na activeren): minder sets en meer reps in reserve, zodat pezen
//     en knieën kunnen wennen.
//   * Deload (elke zoveelste week, of op verzoek): minder sets, zelfde gewicht.
// Week 1 begint op de startdatum van het programma (de dag van activeren).

import { naarDatum } from "./datum.js";

export type FaseNaam = "normaal" | "intro" | "deload";

export interface FaseInstellingen {
  /** JJJJ-MM-DD */
  startdatum: string;
  introWeken: number;
  introSets: number | null;
  introRir: number | null;
  deloadElkeWeken: number | null;
  deloadSetFactor: number;
  /** Handmatige deload tot en met deze dag (JJJJ-MM-DD), of null. */
  deloadTot: string | null;
}

export interface Fase {
  fase: FaseNaam;
  /** 1 = eerste week van het programma */
  week: number;
  handmatig: boolean;
}

export interface RegelDoel {
  aantalSets: number;
  minSets: number;
  doelRir: number | null;
}

const DAG_MS = 24 * 60 * 60 * 1000;

export function programmaWeek(startdatum: string, dag: string): number {
  const dagen = Math.round((naarDatum(dag).getTime() - naarDatum(startdatum).getTime()) / DAG_MS);
  return Math.max(1, Math.floor(dagen / 7) + 1);
}

export function bepaalFase(p: FaseInstellingen, dag: string): Fase {
  const week = programmaWeek(p.startdatum, dag);
  if (p.deloadTot && dag <= p.deloadTot) return { fase: "deload", week, handmatig: true };
  if (week <= p.introWeken) return { fase: "intro", week, handmatig: false };
  if (p.deloadElkeWeken && week % p.deloadElkeWeken === 0) return { fase: "deload", week, handmatig: false };
  return { fase: "normaal", week, handmatig: false };
}

/** Het doel van één oefening in deze fase. Het gewicht verandert hier nooit: dat doet progressie.ts. */
export function doelInFase(regel: RegelDoel, fase: FaseNaam, p: FaseInstellingen): RegelDoel {
  if (fase === "intro") {
    const aantalSets = p.introSets ?? regel.aantalSets;
    return {
      aantalSets,
      minSets: Math.min(regel.minSets, aantalSets),
      doelRir: p.introRir ?? regel.doelRir,
    };
  }
  if (fase === "deload") {
    // Halveren en naar boven afronden: 4 → 2, 3 → 2, 2 → 1.
    const aantalSets = Math.max(1, Math.ceil(regel.aantalSets * p.deloadSetFactor));
    return { aantalSets, minSets: Math.min(regel.minSets, aantalSets), doelRir: regel.doelRir };
  }
  return regel;
}
