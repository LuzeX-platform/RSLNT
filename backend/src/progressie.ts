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
//
// Pro: een andere progressieregel per oefening (opties.regel). De pijnregel, de deload en de
// max-één-stap-regel gelden voor elke regel; alleen stap 5 verschilt:
//   * lineair: alle sets minstens de onderkant van de range (je doel-reps) → één stap omhoog.
//   * rir: alle sets in de range én elke set met minstens één rep méér over dan het doel →
//     één stap omhoog. Zonder ingevulde RIR geen stap: deze regel stuurt op gevoel.
//   * vast: je kiest zelf; RSLNT stelt alleen terug voor bij pijn (geen stagnatieregel).
// Techniekssets (dropset, myo-reps, rest-pause) tellen niet mee voor progressie of stagnatie:
// die zijn per definitie lichter of korter. Voor de pijnregel tellen ze wél mee.
// Deloadtrainingen tellen niet mee voor stagnatie en progressie (ze zijn bewust licht), wel
// voor de pijnregel.

import { PIJN_PLEKKEN, type PijnPlek } from "./pijn.js";

export type Actie = "eerste_keer" | "omhoog" | "gelijk" | "terug" | "moeilijker" | "deload";

export const PROGRESSIE_REGELS = ["dubbel", "lineair", "rir", "vast"] as const;
export type ProgressieRegel = (typeof PROGRESSIE_REGELS)[number];

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
  /** normaal (leeg) | drop | myo | restpauze */
  soort?: string;
}

/** Een gewone werkset, geen techniekset. */
export const isWerkset = (s: { soort?: string | null }) => !s.soort || s.soort === "normaal";

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
 * @param opties.deload de training waarvoor dit voorstel is, is een deloadtraining (of een lichte dag)
 * @param opties.regel de progressieregel (Pro); zonder: dubbele progressie
 */
export function bepaalVoorstel(
  oefening: OefeningInfo,
  doel: Doel,
  historie: EerdereSessie[],
  opties: { deload?: boolean; regel?: ProgressieRegel } = {},
): Voorstel {
  const regel = opties.regel ?? "dubbel";
  const metSets = historie.filter((s) => s.sets.length > 0);
  // Voor de pijnregel alle sets; voor de rest alleen werksets.
  const sessies = metSets
    .map((s) => ({ ...s, sets: s.sets.filter(isWerkset) }))
    .filter((s) => s.sets.length > 0);
  const zonderGewicht = isZonderGewicht(oefening);

  if (metSets.length === 0) {
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
  const vorige = werkSessies[0] ?? sessies[0] ?? metSets[0];
  const wg = zonderGewicht ? null : werkgewicht(vorige);

  const pijn = pijnSignaal(metSets);
  if (pijn) {
    const basis = zonderGewicht ? null : werkgewicht(sessies[0] ?? metSets[0]);
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

  if (regel === "vast") {
    return {
      actie: "gelijk",
      gewicht: wg,
      reden: "Vaste regel: je kiest zelf wanneer het zwaarder wordt. RSLNT grijpt alleen in bij pijn.",
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
  const minSetsVorige = vorige.minSets ?? doel.minSets;

  if (regel === "lineair" || regel === "rir") {
    const genoegSets = vorige.sets.length >= minSetsVorige;
    const inRange = genoegSets && vorige.sets.every((s) => s.reps >= doel.repsMin);
    const doelRir = vorige.doelRir ?? 2;
    let klaar: boolean;
    let nietKlaar: string;
    if (regel === "lineair") {
      klaar = inRange && rirGehaald(vorige);
      nietKlaar = !genoegSets
        ? `Vorige keer ${vorige.sets.length} van minimaal ${minSetsVorige} sets. ${zelfde}`
        : !inRange
          ? `Vorige keer ${reps}: nog niet alle sets op ${doel.repsMin}. ${zelfde}`
          : `Vorige keer ${reps}: wel ${doel.repsMin} reps, maar met minder dan ${doelRir} over. ${zelfde}`;
    } else {
      const zonderRir = vorige.sets.some((s) => s.rir === null);
      klaar = inRange && !zonderRir && vorige.sets.every((s) => (s.rir as number) >= doelRir + 1);
      nietKlaar = !inRange
        ? `Vorige keer ${reps}: nog niet alle sets in de range. ${zelfde}`
        : zonderRir
          ? `Op gevoel: vul bij elke set je RIR in, dan weet RSLNT wanneer het omhoog kan. ${zelfde}`
          : `Vorige keer RIR ${vorige.sets.map((s) => s.rir).join("/")}: omhoog als elke set ${doelRir + 1} of meer over heeft. ${zelfde}`;
    }
    if (klaar && zonderGewicht) {
      return { actie: "moeilijker", gewicht: null, reden: `Vorige keer ${reps}: gehaald. Tijd voor een moeilijkere variant.`, pijnRegel: false };
    }
    if (klaar && wg !== null) {
      const waarom = regel === "lineair" ? `alle sets op ${doel.repsMin} of meer` : `elke set ${doelRir + 1}+ reps over`;
      return {
        actie: "omhoog",
        gewicht: rond(wg + stap),
        reden: `Vorige keer ${reps} met ${kg(wg)}: ${waarom}. Eén stap omhoog (+${kg(stap)}).`,
        pijnRegel: false,
      };
    }
    return { actie: "gelijk", gewicht: wg, reden: nietKlaar, pijnRegel: false };
  }

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

  const minSets = minSetsVorige;
  const reden =
    vorige.sets.length < minSets
      ? `Vorige keer ${vorige.sets.length} van minimaal ${minSets} sets. ${zelfde}`
      : `Vorige keer ${reps}: nog niet alle sets op ${doel.repsMax}. ${zelfde}`;
  return { actie: "gelijk", gewicht: wg, reden, pijnRegel: false };
}
