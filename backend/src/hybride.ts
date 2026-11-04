// Pure logica (Pro): kracht en duurtraining (hardlopen, fietsen …) naast elkaar. Onderzoek laat
// zien dat combineren kracht en spiergroei nauwelijks afremt, wel explosieve kracht, en dat
// hardlopen daarbij meer stoort dan fietsen. Het advies gaat dus vooral over planning: een harde
// duurtraining en een zware benendag niet vlak na elkaar. Zie Wetenschap, #hybride.

import { verschuifDag } from "./datum.js";

export const DUUR_SOORTEN = {
  hardlopen: "Hardlopen",
  fietsen: "Fietsen",
  zwemmen: "Zwemmen",
  roeien: "Roeien",
  wandelen: "Wandelen",
  anders: "Anders",
} as const;
export type DuurSoort = keyof typeof DUUR_SOORTEN;
export const DUUR_SOORT_SLEUTELS = Object.keys(DUUR_SOORTEN) as [DuurSoort, ...DuurSoort[]];

export const INTENSITEITEN = {
  rustig: "Rustig (praten gaat makkelijk)",
  duur: "Duur (praten gaat nog)",
  tempo: "Tempo (korte zinnen)",
  interval: "Interval (hard, met pauzes)",
} as const;
export type Intensiteit = keyof typeof INTENSITEITEN;
export const INTENSITEIT_SLEUTELS = Object.keys(INTENSITEITEN) as [Intensiteit, ...Intensiteit[]];

export interface DuurSessie {
  datum: string;
  soort: string;
  minuten: number;
  intensiteit: string;
}

/** Hard voor je benen: tempo of interval van een kwartier of meer, of alles vanaf 75 minuten. */
export function isZwaar(s: DuurSessie): boolean {
  return ((s.intensiteit === "tempo" || s.intensiteit === "interval") && s.minuten >= 15) || s.minuten >= 75;
}

/** Vanaf zoveel fractionele sets voor quads, hamstrings, billen en kuiten is een training "zwaar voor je benen". */
export const BENEN_SETS = 4;
export const BEEN_SPIEREN = ["quads", "hamstrings", "glutes", "calves", "adductors"];

export interface HybrideAdvies {
  meldingen: string[];
  week: { minuten: number; sessies: number; zwaar: number; perSoort: Record<string, number> };
}

/**
 * @param duur je duurtrainingen (elke volgorde)
 * @param volgende de training die aan de beurt is, met zijn fractionele sets voor de benen
 */
export function hybrideAdvies(
  duur: DuurSessie[],
  vandaag: string,
  volgende: { naam: string; benenSets: number } | null,
): HybrideAdvies {
  const gisteren = verschuifDag(vandaag, -1);
  const weekVan = verschuifDag(vandaag, -6);
  const week = duur.filter((d) => d.datum >= weekVan && d.datum <= vandaag);
  const meldingen: string[] = [];

  const recentZwaar = duur.filter((d) => (d.datum === vandaag || d.datum === gisteren) && isZwaar(d));
  if (recentZwaar.length && volgende && volgende.benenSets >= BENEN_SETS) {
    const wanneer = recentZwaar.some((d) => d.datum === vandaag) ? "Vandaag" : "Gisteren";
    meldingen.push(
      `${wanneer} een zware duurtraining, en ${volgende.naam} is zwaar voor je benen. Liever eerst een training voor je bovenlichaam, of houd minstens 6 uur tussen de twee.`,
    );
  }
  const loopMinuten = week.filter((d) => d.soort === "hardlopen").reduce((s, d) => s + d.minuten, 0);
  if (loopMinuten >= 150) {
    meldingen.push(
      `${loopMinuten} minuten hardlopen in 7 dagen. Kracht en spiergroei blijven gewoon mogelijk; plan je zwaarste benentraining en je hardste loop op verschillende dagen.`,
    );
  }
  const zwaar = week.filter(isZwaar).length;
  if (zwaar >= 3) meldingen.push(`${zwaar} zware duurtrainingen in 7 dagen. Houd daar rekening mee als je herstel tegenvalt.`);

  const perSoort: Record<string, number> = {};
  for (const d of week) perSoort[d.soort] = (perSoort[d.soort] ?? 0) + d.minuten;
  return {
    meldingen,
    week: { minuten: week.reduce((s, d) => s + d.minuten, 0), sessies: week.length, zwaar, perSoort },
  };
}
