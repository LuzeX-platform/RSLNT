// Pure logica: het voorstel voor de volgende keer per oefening (dubbele progressie).
// Geen database en geen "vandaag": alles wat meetelt komt als argument binnen, zodat elke
// regel met een unittest vast te leggen is. De AI-coach (fase 4) krijgt deze regels als
// vangrail: de pijnregel en de max-één-stap-regel kan hij niet overrulen.
//
// De regels, in deze volgorde:
//   1. Geen eerdere sessie → geen voorstel, je kiest zelf.
//   2. Pijn gaat voor alles. Geldt voor de oefening waarbij je pijn meldt, waar die ook zit
//      (knie, schouder, …): hoogste pijn vorige keer ≥ 4, of stijgend (≥ 2 punten hoger dan de
//      keer daarvoor, of drie sessies op rij hoger) → 10% terug, naar beneden afgerond op de
//      gewichtsstap, minimaal één stap.
//   3. Deloadweek → zelfde gewicht, minder sets (dat laatste regelt fase.ts).
//   4. Stagnatie: twee trainingen op rij meer dan de helft van de sets onder de onderkant van
//      de range → 10% terug en opnieuw opbouwen.
//   5. Alle sets (minstens het geplande minimum) op de bovenkant van de range, met minstens de
//      doel-RIR over → één kleinste stap omhoog. Nooit meer dan één stap.
//   6. Anders: zelfde gewicht.
// Pijn of RIR die niet is ingevuld is onbekend, niet 0: die telt niet mee.
// Deloadtrainingen tellen niet mee voor stagnatie en progressie (ze zijn bewust licht), wel
// voor de pijnregel.

import { PIJN_PLEKKEN, type PijnPlek } from "./pijn.js";

export type Actie = "eerste_keer" | "omhoog" | "gelijk" | "terug" | "moeilijker" | "deload";

export interface OefeningInfo {
  materiaal: string;
  gewichtsstap: number;
}

export interface Doel {
  minSets: number;
  repsMin: number;
  repsMax: number;
}

export interface GelogdeSet {
  gewicht: number | null;
  reps: number;
  rir: number | null;
  /** Pijn tijdens de set, 0–10. */
  pijn: number | null;
  /** Waar (pijn.ts); leeg als het niet gezegd is. */
  pijnPlek?: string | null;
}

/** De sets van één eerdere training voor deze oefening, met het plan van die dag. */
export interface EerdereSessie {
  sets: GelogdeSet[];
  /** Geplande minimum sets die dag (intro/deload kunnen minder zijn). Leeg: die van het doel. */
  minSets?: number;
  doelRir?: number | null;
  deload?: boolean;
}

export interface Voorstel {
  actie: Actie;
  /** Voorgesteld werkgewicht; null bij de eerste keer en zonder gewicht. */
  gewicht: number | null;
  reden: string;
  /** true als de pijnregel dit voorstel bepaalde. */
  pijnRegel: boolean;
}

export const PIJN_GRENS = 4;
export const PIJN_STIJGING = 2;
export const TERUG_FACTOR = 0.9;

/** Afronden op twee decimalen, zodat 0,1 + 0,2 geen 0,30000000000000004 kg wordt. */
function rond(kg: number): number {
  return Math.round(kg * 100) / 100;
}

export function kg(waarde: number): string {
  return `${String(rond(waarde)).replace(".", ",")} kg`;
}

/** Zonder gewicht: geen gewichtsstap (dead bug). Een back extension met een schijf heeft er wel een. */
export function isZonderGewicht(oefening: Pick<OefeningInfo, "gewichtsstap">): boolean {
  return oefening.gewichtsstap <= 0;
}

/** Naar beneden afronden op een veelvoud van de gewichtsstap (wat er in het rek ligt). */
export function rondOmlaag(waarde: number, stap: number): number {
  if (stap <= 0) return rond(waarde);
  return rond(Math.floor(waarde / stap + 1e-9) * stap);
}

/** Het gewicht waarmee alle sets gedaan zijn: bij wisselende gewichten het laagste. */
export function werkgewicht(sessie: EerdereSessie): number | null {
  const gewichten = sessie.sets.map((s) => s.gewicht).filter((g): g is number => g !== null);
  return gewichten.length ? Math.min(...gewichten) : null;
}

export function maxPijn(sessie: EerdereSessie | undefined): number | null {
  if (!sessie) return null;
  const waarden = sessie.sets.map((s) => s.pijn).filter((k): k is number => k !== null);
  return waarden.length ? Math.max(...waarden) : null;
}

/** "Pijn" of, als de plek bekend is, "Pijn (knie)": de plek van de pijnlijkste set. */
function pijnLabel(sessie: EerdereSessie): string {
  const hoogste = Math.max(...sessie.sets.map((s) => s.pijn ?? -1));
  const plek = sessie.sets.find((s) => s.pijn === hoogste && s.pijnPlek)?.pijnPlek;
  return plek && plek in PIJN_PLEKKEN ? `Pijn (${PIJN_PLEKKEN[plek as PijnPlek].toLowerCase()})` : "Pijn";
}

/** De reden waarom de pijnregel ingrijpt, of null. Sessies: nieuwste eerst. */
export function pijnSignaal(sessies: EerdereSessie[]): string | null {
  const [p0, p1, p2] = [maxPijn(sessies[0]), maxPijn(sessies[1]), maxPijn(sessies[2])];
  if (p0 === null) return null;
  const label = pijnLabel(sessies[0]);
  if (p0 >= PIJN_GRENS) return `${label} ${p0}/10 vorige keer (grens is ${PIJN_GRENS}).`;
  if (p1 !== null && p0 - p1 >= PIJN_STIJGING) return `${label} steeg van ${p1} naar ${p0}.`;
  if (p1 !== null && p2 !== null && p2 < p1 && p1 < p0) {
    return `${label} stijgt drie trainingen op rij (${p2} → ${p1} → ${p0}).`;
  }
  return null;
}

/** Meer dan de helft van de sets onder de onderkant van de range. */
export function onderRange(sessie: EerdereSessie, doel: Doel): boolean {
  const onder = sessie.sets.filter((s) => s.reps < doel.repsMin).length;
  return sessie.sets.length > 0 && onder > sessie.sets.length / 2;
}

export function repsBovenkant(sessie: EerdereSessie, doel: Doel): boolean {
  return sessie.sets.length >= (sessie.minSets ?? doel.minSets) && sessie.sets.every((s) => s.reps >= doel.repsMax);
}

/** RIR van alle sets minstens het doel. Sets zonder ingevulde RIR tellen als gehaald. */
export function rirGehaald(sessie: EerdereSessie): boolean {
  const doelRir = sessie.doelRir;
  if (doelRir === null || doelRir === undefined) return true;
  return sessie.sets.every((s) => s.rir === null || s.rir >= doelRir);
}

function tienProcentTerug(wg: number, stap: number): number {
  // Minimaal één stap terug: bij lichte gewichten is 10% minder dan de kleinste stap.
  return Math.max(0, rondOmlaag(Math.min(wg * TERUG_FACTOR, wg - stap), stap));
}

/**
 * Het voorstel voor de volgende keer.
 * @param doel de rep-range zoals die nú in het schema staat (daar train je de volgende keer op)
 * @param historie eerdere sessies van deze oefening, nieuwste eerst
 * @param opties.deload de training waarvoor dit voorstel is, is een deloadtraining
 */
export function bepaalVoorstel(
  oefening: OefeningInfo,
  doel: Doel,
  historie: EerdereSessie[],
  opties: { deload?: boolean } = {},
): Voorstel {
  const sessies = historie.filter((s) => s.sets.length > 0);
  const zonderGewicht = isZonderGewicht(oefening);

  if (sessies.length === 0) {
    return {
      actie: "eerste_keer",
      gewicht: null,
      reden: zonderGewicht
        ? "Eerste keer: kijk hoeveel reps je netjes haalt."
        : "Eerste keer: kies zelf een startgewicht waarmee je de range haalt.",
      pijnRegel: false,
    };
  }

  const stap = oefening.gewichtsstap;
  // Voor progressie en stagnatie tellen deloadtrainingen niet; zijn er alleen deloads, dan die.
  const werkSessies = sessies.filter((s) => !s.deload);
  const vorige = werkSessies[0] ?? sessies[0];
  const wg = zonderGewicht ? null : werkgewicht(vorige);

  const pijn = pijnSignaal(sessies);
  if (pijn) {
    const basis = zonderGewicht ? null : werkgewicht(sessies[0]);
    if (basis === null) {
      return { actie: "terug", gewicht: null, reden: `${pijn} Rustiger aan: minder reps of een lichtere variant.`, pijnRegel: true };
    }
    const nieuw = tienProcentTerug(basis, stap);
    return { actie: "terug", gewicht: nieuw, reden: `${pijn} Daarom 10% terug: ${kg(basis)} → ${kg(nieuw)}.`, pijnRegel: true };
  }

  if (opties.deload) {
    return {
      actie: "deload",
      gewicht: wg,
      reden: "Deloadweek: minder sets, zelfde gewicht. Herstellen hoort bij trainen.",
      pijnRegel: false,
    };
  }

  if (werkSessies.length >= 2 && onderRange(werkSessies[0], doel) && onderRange(werkSessies[1], doel)) {
    const reden = `Twee trainingen op rij onder de ${doel.repsMin} reps.`;
    if (wg === null) {
      return { actie: "terug", gewicht: null, reden: `${reden} Kies een makkelijkere variant en bouw opnieuw op.`, pijnRegel: false };
    }
    const nieuw = tienProcentTerug(wg, stap);
    return { actie: "terug", gewicht: nieuw, reden: `${reden} 10% terug en opnieuw opbouwen: ${kg(wg)} → ${kg(nieuw)}.`, pijnRegel: false };
  }

  const reps = vorige.sets.map((s) => s.reps).join("/");
  const zelfde = zonderGewicht ? "Zelfde variant, probeer meer reps." : "Zelfde gewicht.";

  if (repsBovenkant(vorige, doel)) {
    if (!rirGehaald(vorige)) {
      return {
        actie: "gelijk",
        gewicht: wg,
        reden: `Vorige keer ${reps}: alle sets op ${doel.repsMax}, maar met minder dan ${vorige.doelRir} reps over. ${zelfde}`,
        pijnRegel: false,
      };
    }
    if (zonderGewicht) {
      return {
        actie: "moeilijker",
        gewicht: null,
        reden: `Vorige keer ${reps}: alle sets op ${doel.repsMax}. Tijd voor een moeilijkere variant of een langzamer tempo.`,
        pijnRegel: false,
      };
    }
    if (wg !== null) {
      return {
        actie: "omhoog",
        gewicht: rond(wg + stap),
        reden: `Vorige keer ${reps} met ${kg(wg)}: alle sets op ${doel.repsMax}. Eén stap omhoog (+${kg(stap)}).`,
        pijnRegel: false,
      };
    }
  }

  const minSets = vorige.minSets ?? doel.minSets;
  const reden =
    vorige.sets.length < minSets
      ? `Vorige keer ${vorige.sets.length} van minimaal ${minSets} sets. ${zelfde}`
      : `Vorige keer ${reps}: nog niet alle sets op ${doel.repsMax}. ${zelfde}`;
  return { actie: "gelijk", gewicht: wg, reden, pijnRegel: false };
}
