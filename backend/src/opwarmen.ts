// Pure logica: opwarmsets vóór je eerste werkset (gratis, voor iedereen). Een korte opbouw naar
// je werkgewicht: weinig reps, zodat het opwarmen niet ten koste gaat van je werksets.
// Een praktijkregel, geen gemeten schema: zie Wetenschap, #opwarmsets.
//
// Afgewogen: een vast percentage van je 1RM (zoals in krachtsportschema's) — dat vraagt een 1RM
// die veel mensen niet weten, en het werkgewicht staat hier toch al klaar in het voorstel.

import { rondOmlaag } from "./progressie.js";

export interface Opwarmset {
  gewicht: number;
  reps: number;
  /** Ten opzichte van het werkgewicht, afgerond (alleen ter uitleg). */
  procent: number;
}

/** Gewicht van een lege stang, alleen waar dat vast ligt. Een trap bar verschilt per sportschool. */
export const LEGE_STANG: Record<string, number> = { barbell: 20 };

/**
 * @param werkgewicht het gewicht van je eerste werkset (het voorstel, of wat je vorige keer deed)
 * @param stap kleinste gewichtsstap van de oefening
 */
export function opwarmsets(werkgewicht: number | null, stap: number, materiaal: string): Opwarmset[] {
  if (werkgewicht === null || stap <= 0 || werkgewicht <= stap) return [];
  const stang = LEGE_STANG[materiaal] ?? 0;
  const opbouw: [number, number][] =
    werkgewicht < 20 ? [[0.5, 8]] : werkgewicht < 60 ? [[0.5, 8], [0.75, 4]] : [[0.4, 8], [0.6, 5], [0.8, 3]];
  const sets: Opwarmset[] = [];
  if (stang > 0 && werkgewicht >= 40) sets.push({ gewicht: stang, reps: 10, procent: Math.round((stang / werkgewicht) * 100) });
  for (const [factor, reps] of opbouw) {
    const gewicht = Math.max(stang, rondOmlaag(werkgewicht * factor, stap));
    if (gewicht <= 0 || gewicht >= werkgewicht) continue;
    if (sets.some((s) => s.gewicht === gewicht)) continue;
    sets.push({ gewicht, reps, procent: Math.round((gewicht / werkgewicht) * 100) });
  }
  return sets;
}
