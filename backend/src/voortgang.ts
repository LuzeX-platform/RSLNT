// Pure logica voor het dashboard: geschatte 1RM en sets per spiergroep. Formules en bronnen staan
// op de Wetenschap-pagina (#e1rm en #volume).

import { naarDatum, verschuifDag } from "./datum.js";

const rond = (waarde: number, decimalen = 1) => Math.round(waarde * 10 ** decimalen) / 10 ** decimalen;

/**
 * Geschatte 1RM volgens Epley, met de reps die je nog over had erbij geteld:
 * gewicht × (1 + (reps + RIR) / 30). Boven ~20 (reps + RIR) wordt de schatting onbetrouwbaar
 * en geven we niets terug. Zonder RIR rekenen we alsof je tot falen ging (een ondergrens).
 */
export function e1rm(gewicht: number | null, reps: number, rir: number | null): number | null {
  if (gewicht === null || gewicht <= 0 || reps < 1) return null;
  const totaal = reps + (rir ?? 0);
  if (totaal > 20) return null;
  return rond(gewicht * (1 + totaal / 30));
}

export function besteE1rm(sets: { gewicht: number | null; reps: number; rir: number | null }[]): number | null {
  const waarden = sets.map((s) => e1rm(s.gewicht, s.reps, s.rir)).filter((w): w is number => w !== null);
  return waarden.length ? Math.max(...waarden) : null;
}

/** Maandag van de week waarin deze dag valt (JJJJ-MM-DD). */
export function weekStart(dag: string): string {
  const weekdag = naarDatum(dag).getUTCDay(); // 0 = zondag
  return verschuifDag(dag, weekdag === 0 ? -6 : 1 - weekdag);
}

export interface SetSpieren {
  spierenPrimair: string[];
  spierenSecundair: string[];
  /** aantal sets (gelogd of gepland) */
  sets: number;
}

/**
 * Fractionele sets per spiergroep: een set telt 1 voor elke hoofdspier en ½ voor elke hulpspier
 * (Pelland 2025). Een spier die zowel hoofd- als hulpspier is, telt één keer als hoofdspier.
 */
export function fractioneleSets(regels: SetSpieren[]): Record<string, number> {
  const totaal: Record<string, number> = {};
  for (const r of regels) {
    for (const spier of r.spierenPrimair) totaal[spier] = (totaal[spier] ?? 0) + r.sets;
    for (const spier of r.spierenSecundair) {
      if (r.spierenPrimair.includes(spier)) continue;
      totaal[spier] = (totaal[spier] ?? 0) + r.sets * 0.5;
    }
  }
  for (const spier of Object.keys(totaal)) totaal[spier] = rond(totaal[spier]);
  return totaal;
}

/** Boven ~11 fractionele sets per spier per training is extra opbrengst niet aantoonbaar (Remmert 2025, preprint). */
export const SETS_PER_TRAINING_GRENS = 11;

/** Ten minste 10 sets per week gaf meer groei dan minder (Schoenfeld 2017). Referentielijn, geen harde norm. */
export const SETS_PER_WEEK_REFERENTIE = 10;

/** Spiergroepen per training boven de grens: [{ spier, sets }]. */
export function teVolPerTraining(regels: SetSpieren[]): { spier: string; sets: number }[] {
  return Object.entries(fractioneleSets(regels))
    .filter(([, sets]) => sets > SETS_PER_TRAINING_GRENS)
    .map(([spier, sets]) => ({ spier, sets }))
    .sort((a, b) => b.sets - a.sets);
}

/** De kalenderdag van een tijdstip in Nederland. */
export function dagVan(moment: Date): string {
  return moment.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

