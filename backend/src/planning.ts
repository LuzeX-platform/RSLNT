// De weekplanner: welke training op welke dag. Pure logica (geen database), zodat de regels te
// testen zijn: de standaardindeling over de week en wat er vandaag en daarna aan de beurt is.

import { naarDatum, verschuifDag } from "./datum.js";

export const WEEKDAGEN = ["maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag", "zondag"] as const;

/** 1 = maandag … 7 = zondag, voor een kalenderdag (JJJJ-MM-DD). */
export function weekdagVan(dag: string): number {
  const d = naarDatum(dag).getUTCDay(); // 0 = zondag
  return d === 0 ? 7 : d;
}

/** Maandag van de week waarin deze dag valt. */
export function maandagVan(dag: string): string {
  return verschuifDag(dag, 1 - weekdagVan(dag));
}

/**
 * Een begin dat voor de meeste mensen werkt: zo veel mogelijk een rustdag ertussen, en het weekend
 * pas als het moet.
 */
export function standaardDagen(aantal: number): number[] {
  const indeling: Record<number, number[]> = {
    1: [3],
    2: [1, 4],
    3: [1, 3, 5],
    4: [1, 2, 4, 5],
    5: [1, 2, 3, 4, 5],
    6: [1, 2, 3, 4, 5, 6],
    7: [1, 2, 3, 4, 5, 6, 7],
  };
  return indeling[Math.max(1, Math.min(aantal, 7))];
}

export interface Geplande {
  weekdag: number;
  schemaId: string;
  tijd: string;
}

export const TIJD = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Wat er volgens de planning aan de beurt is.
 * - vandaag: de training van vandaag, als je die deze week nog niet deed.
 * - volgende: de eerstvolgende geplande dag waarvan je de training deze week nog niet deed (een
 *   dag in een volgende week telt altijd). Deed je woensdag al op dinsdag, dan is vrijdag de volgende.
 * @param gedaanDezeWeek schema's die je sinds maandag al trainde
 */
export function aanDeBeurt(planning: Geplande[], dag: string, gedaanDezeWeek: Set<string>): { vandaag: Geplande | null; volgende: (Geplande & { datum: string }) | null } {
  if (planning.length === 0) return { vandaag: null, volgende: null };
  const vandaagGepland = planning.find((p) => p.weekdag === weekdagVan(dag)) ?? null;
  const vandaag = vandaagGepland && !gedaanDezeWeek.has(vandaagGepland.schemaId) ? vandaagGepland : null;
  const dezeWeek = maandagVan(dag);
  for (let stap = 1; stap <= 14; stap++) {
    const datum = verschuifDag(dag, stap);
    const p = planning.find((x) => x.weekdag === weekdagVan(datum));
    if (!p) continue;
    if (maandagVan(datum) === dezeWeek && gedaanDezeWeek.has(p.schemaId)) continue;
    return { vandaag, volgende: { ...p, datum } };
  }
  return { vandaag, volgende: null };
}
