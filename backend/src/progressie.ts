// Pure logica: het voorstel voor de volgende keer per oefening (dubbele progressie).
// Geen database en geen "vandaag": alles wat meetelt komt als argument binnen, zodat elke
// regel met een unittest vast te leggen is. De AI-coach (fase 4) krijgt deze regels als
// vangrail: de kniepijnregel en de max-één-stap-regel kan hij niet overrulen.
//
// De regels, in deze volgorde:
//   1. Geen eerdere sessie → geen voorstel, je kiest zelf.
//   2. Kniepijn gaat voor alles: hoogste kniepijn vorige keer ≥ 4, of stijgend
//      (≥ 2 punten hoger dan de keer daarvoor, of drie sessies op rij hoger)
//      → 10% terug, naar beneden afgerond op de gewichtsstap, minimaal één stap.
//   3. Alle sets (minstens minSets) op de bovenkant van de range → één kleinste stap omhoog.
//      Nooit meer dan één stap, hoe ver je ook boven de range zat.
//   4. Anders: zelfde gewicht.
// Kniepijn die niet is ingevuld is onbekend, niet 0: die telt niet mee in de vergelijking.

export type Actie = "eerste_keer" | "omhoog" | "gelijk" | "terug" | "moeilijker";

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
  kniepijn: number | null;
}

/** De sets van één eerdere training voor deze oefening. */
export interface EerdereSessie {
  sets: GelogdeSet[];
}

export interface Voorstel {
  actie: Actie;
  /** Voorgesteld werkgewicht; null bij de eerste keer en bij lichaamsgewicht. */
  gewicht: number | null;
  reden: string;
  /** true als de kniepijnregel dit voorstel bepaalde. */
  kniepijnRegel: boolean;
}

export const KNIEPIJN_GRENS = 4;
export const KNIEPIJN_STIJGING = 2;
export const TERUG_FACTOR = 0.9;

/** Afronden op twee decimalen, zodat 0,1 + 0,2 geen 0,30000000000000004 kg wordt. */
function rond(kg: number): number {
  return Math.round(kg * 100) / 100;
}

export function kg(waarde: number): string {
  return `${String(rond(waarde)).replace(".", ",")} kg`;
}

export function isLichaamsgewicht(oefening: OefeningInfo): boolean {
  return oefening.materiaal === "lichaamsgewicht" || oefening.gewichtsstap <= 0;
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

export function maxKniepijn(sessie: EerdereSessie | undefined): number | null {
  if (!sessie) return null;
  const waarden = sessie.sets.map((s) => s.kniepijn).filter((k): k is number => k !== null);
  return waarden.length ? Math.max(...waarden) : null;
}

/** De reden waarom de kniepijnregel ingrijpt, of null. Sessies: nieuwste eerst. */
export function kniepijnSignaal(sessies: EerdereSessie[]): string | null {
  const [p0, p1, p2] = [maxKniepijn(sessies[0]), maxKniepijn(sessies[1]), maxKniepijn(sessies[2])];
  if (p0 === null) return null;
  if (p0 >= KNIEPIJN_GRENS) return `Kniepijn ${p0}/10 vorige keer (grens is ${KNIEPIJN_GRENS}).`;
  if (p1 !== null && p0 - p1 >= KNIEPIJN_STIJGING) return `Kniepijn steeg van ${p1} naar ${p0}.`;
  if (p1 !== null && p2 !== null && p2 < p1 && p1 < p0) {
    return `Kniepijn stijgt drie trainingen op rij (${p2} → ${p1} → ${p0}).`;
  }
  return null;
}

export function bovenkantGehaald(sets: GelogdeSet[], doel: Doel): boolean {
  return sets.length >= doel.minSets && sets.every((s) => s.reps >= doel.repsMax);
}

/**
 * Het voorstel voor de volgende keer.
 * @param doel het doel zoals het nú in het schema staat (daar train je de volgende keer op)
 * @param historie eerdere sessies van deze oefening, nieuwste eerst
 */
export function bepaalVoorstel(oefening: OefeningInfo, doel: Doel, historie: EerdereSessie[]): Voorstel {
  const sessies = historie.filter((s) => s.sets.length > 0);
  const lichaamsgewicht = isLichaamsgewicht(oefening);

  if (sessies.length === 0) {
    return {
      actie: "eerste_keer",
      gewicht: null,
      reden: lichaamsgewicht
        ? "Eerste keer: kijk hoeveel reps je netjes haalt."
        : "Eerste keer: kies zelf een startgewicht waarmee je de range haalt.",
      kniepijnRegel: false,
    };
  }

  const vorige = sessies[0];
  const stap = oefening.gewichtsstap;
  const wg = lichaamsgewicht ? null : werkgewicht(vorige);

  const knie = kniepijnSignaal(sessies);
  if (knie) {
    if (wg === null) {
      return {
        actie: "terug",
        gewicht: null,
        reden: `${knie} Rustiger aan: minder reps of een lichtere variant.`,
        kniepijnRegel: true,
      };
    }
    // Minimaal één stap terug: bij lichte gewichten is 10% minder dan de kleinste stap.
    const nieuw = Math.max(0, rondOmlaag(Math.min(wg * TERUG_FACTOR, wg - stap), stap));
    return {
      actie: "terug",
      gewicht: nieuw,
      reden: `${knie} Daarom 10% terug: ${kg(wg)} → ${kg(nieuw)}.`,
      kniepijnRegel: true,
    };
  }

  const reps = vorige.sets.map((s) => s.reps).join("/");

  if (bovenkantGehaald(vorige.sets, doel)) {
    if (lichaamsgewicht) {
      return {
        actie: "moeilijker",
        gewicht: null,
        reden: `Vorige keer ${reps}: alle sets op ${doel.repsMax}. Tijd voor een moeilijkere variant of een langzamer tempo.`,
        kniepijnRegel: false,
      };
    }
    if (wg !== null) {
      return {
        actie: "omhoog",
        gewicht: rond(wg + stap),
        reden: `Vorige keer ${reps} met ${kg(wg)}: alle sets op ${doel.repsMax}. Eén stap omhoog (+${kg(stap)}).`,
        kniepijnRegel: false,
      };
    }
  }

  const zelfde = lichaamsgewicht ? "Zelfde variant, probeer meer reps." : "Zelfde gewicht.";
  const reden =
    vorige.sets.length < doel.minSets
      ? `Vorige keer ${vorige.sets.length} van minimaal ${doel.minSets} sets. ${zelfde}`
      : `Vorige keer ${reps}: nog niet alle sets op ${doel.repsMax}. ${zelfde}`;
  return { actie: "gelijk", gewicht: wg, reden, kniepijnRegel: false };
}
