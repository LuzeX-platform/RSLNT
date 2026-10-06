// Pure logica rond lichaamsgewicht. Het 7-daags gemiddelde is het gemiddelde van alle wegingen
// in de zeven kalenderdagen tot en met de gevraagde dag. Dagen zonder weging tellen niet mee
// (geen opvulling): wie twee keer per week weegt, krijgt het gemiddelde van die twee.

import { verschuifDag } from "./datum.js";

export interface Meting {
  /** JJJJ-MM-DD */
  datum: string;
  gewicht: number;
}

function rond(waarde: number): number {
  return Math.round(waarde * 100) / 100;
}

export function zevenDaagsGemiddelde(metingen: Meting[], totEnMet: string): number | null {
  const vanaf = verschuifDag(totEnMet, -6);
  const inVenster = metingen.filter((m) => m.datum >= vanaf && m.datum <= totEnMet);
  if (inVenster.length === 0) return null;
  return rond(inVenster.reduce((som, m) => som + m.gewicht, 0) / inVenster.length);
}

/** Elke meting met het 7-daags gemiddelde op die dag. Nieuwste eerst. */
export function metGemiddelde(metingen: Meting[]): (Meting & { gemiddelde7: number })[] {
  return [...metingen]
    .sort((a, b) => b.datum.localeCompare(a.datum))
    .map((m) => ({ ...m, gemiddelde7: zevenDaagsGemiddelde(metingen, m.datum) as number }));
}
