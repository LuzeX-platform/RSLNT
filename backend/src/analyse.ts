// Pure logica voor de Pro-analyse onder Voortgang: krachttrend met voorspelling, records per
// aantal reps, richtgewichten, volume per spiergroep in zones en je krachtniveau.
// Formules en bronnen staan op de Wetenschap-pagina (#krachttrend, #volume-zones, #krachtniveau).

import { rondOmlaag } from "./progressie.js";
import { verschuifDag } from "./datum.js";

const rond = (waarde: number, decimalen = 1) => Math.round(waarde * 10 ** decimalen) / 10 ** decimalen;
const DAG_MS = 86400000;
const dagNummer = (dag: string) => Math.round(Date.parse(`${dag}T12:00:00Z`) / DAG_MS);

// ---------- Krachttrend ----------

export interface Trend {
  /** Aantal trainingen in het venster. */
  punten: number;
  kgPerWeek: number;
  /** Ten opzichte van je gemiddelde in het venster. */
  procentPerMaand: number;
  /** Lijn door de punten, op vandaag. */
  nu: number;
  /** Als het tempo gelijk blijft; null met minder dan 4 punten. */
  over4Weken: number | null;
  over8Weken: number | null;
}

/** Het venster van de trend: de laatste 8 weken. Ouder zegt weinig meer over je tempo van nu. */
export const TREND_DAGEN = 56;

/**
 * Lijn door je geschatte 1RM van de laatste 8 weken (kleinste kwadraten). Minstens 3 trainingen,
 * minstens 14 dagen uit elkaar; anders zegt een lijn niets. Een voorspelling pas vanaf 4 punten,
 * en nooit verder dan 8 weken vooruit.
 */
export function krachtTrend(punten: { datum: string; e1rm: number }[], vandaag: string): Trend | null {
  const vanaf = verschuifDag(vandaag, -(TREND_DAGEN - 1));
  const recent = punten.filter((p) => p.datum >= vanaf && p.datum <= vandaag);
  if (recent.length < 3) return null;
  const xs = recent.map((p) => dagNummer(p.datum));
  if (Math.max(...xs) - Math.min(...xs) < 14) return null;
  const ys = recent.map((p) => p.e1rm);
  const n = recent.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let teller = 0;
  let noemer = 0;
  for (let i = 0; i < n; i++) {
    teller += (xs[i] - mx) * (ys[i] - my);
    noemer += (xs[i] - mx) ** 2;
  }
  const helling = teller / noemer; // kg per dag
  const opDag = (dag: number) => my + helling * (dag - mx);
  const vandaagNr = dagNummer(vandaag);
  return {
    punten: n,
    kgPerWeek: rond(helling * 7, 2),
    procentPerMaand: rond(((helling * 30) / my) * 100, 1),
    nu: rond(opDag(vandaagNr)),
    over4Weken: n >= 4 ? rond(opDag(vandaagNr + 28)) : null,
    over8Weken: n >= 4 ? rond(opDag(vandaagNr + 56)) : null,
  };
}

// ---------- Records per aantal reps ----------

export interface RepRecord {
  reps: number;
  gewicht: number;
  datum: string;
}

/** Je zwaarste set per aantal reps (1 t/m 15). Bij gelijk gewicht telt de eerste keer. */
export function repRecords(sets: { gewicht: number | null; reps: number; datum: string }[]): RepRecord[] {
  const beste = new Map<number, RepRecord>();
  for (const s of [...sets].sort((a, b) => a.datum.localeCompare(b.datum))) {
    if (s.gewicht === null || s.gewicht <= 0 || s.reps < 1 || s.reps > 15) continue;
    const huidig = beste.get(s.reps);
    if (!huidig || s.gewicht > huidig.gewicht) beste.set(s.reps, { reps: s.reps, gewicht: s.gewicht, datum: s.datum });
  }
  return [...beste.values()].sort((a, b) => a.reps - b.reps);
}

// ---------- Richtgewichten ----------

export const RICHT_REPS = [3, 5, 8, 10, 12, 15];

/**
 * Epley omgekeerd: het gewicht waarmee je `reps` haalt met `rir` over, uit je geschatte 1RM,
 * naar beneden afgerond op je gewichtsstap. Zelfde formule als de e1RM (voortgang.ts).
 */
export function richtgewicht(e1rm: number, reps: number, rir: number, stap: number): number {
  return rondOmlaag(e1rm / (1 + (reps + rir) / 30), stap);
}

export function richtgewichten(e1rm: number, stap: number, rir = 2): { reps: number; gewicht: number }[] {
  return RICHT_REPS.map((reps) => ({ reps, gewicht: richtgewicht(e1rm, reps, rir, stap) }));
}

// ---------- Volume in zones ----------

export type VolumeZone = "laag" | "matig" | "productief" | "hoog";

/**
 * Fractionele sets per spiergroep per week. Grenzen als richtpunt, geen norm: onder ~4 gebeurt
 * weinig, vanaf ~10 groeit het meeste, boven ~20 levert extra nog maar weinig op en kost het vooral
 * herstel (Pelland 2025, Baz-Valle 2022). De precieze grenzen zijn onze afspraak.
 */
export const VOLUME_ZONES: { zone: VolumeZone; vanaf: number; label: string }[] = [
  { zone: "laag", vanaf: 0, label: "Weinig" },
  { zone: "matig", vanaf: 4, label: "Matig" },
  { zone: "productief", vanaf: 10, label: "Productief" },
  { zone: "hoog", vanaf: 20, label: "Hoog" },
];

export function volumeZone(setsPerWeek: number): VolumeZone {
  let zone: VolumeZone = "laag";
  for (const z of VOLUME_ZONES) if (setsPerWeek >= z.vanaf) zone = z.zone;
  return zone;
}

export interface SpierWeken {
  spier: string;
  /** Sets per blok van 7 dagen, oudste eerst; het laatste blok eindigt vandaag. */
  weken: number[];
  /** Gemiddeld per week over de blokken vanaf je eerste training erin. */
  gemiddeld: number;
  zone: VolumeZone;
  /** Laatste 4 weken tegen de 4 daarvoor: meer dan 2 sets per week verschil is op of af. */
  richting: "op" | "af" | "gelijk" | null;
}

/**
 * @param perBlok per blok van 7 dagen (oudste eerst) de fractionele sets per spier
 * @param telVanaf index van het eerste blok met een training: daarvoor telt niet mee in het gemiddelde
 */
export function volumePerWeek(perBlok: Record<string, number>[], telVanaf: number): SpierWeken[] {
  const spieren = [...new Set(perBlok.flatMap((b) => Object.keys(b)))];
  const geteld = perBlok.slice(Math.max(0, telVanaf));
  return spieren
    .map((spier) => {
      const weken = perBlok.map((b) => rond(b[spier] ?? 0));
      const telbaar = geteld.map((b) => b[spier] ?? 0);
      const gemiddeld = telbaar.length ? rond(telbaar.reduce((a, b) => a + b, 0) / telbaar.length) : 0;
      let richting: SpierWeken["richting"] = null;
      if (telbaar.length >= 8) {
        const som = (l: number[]) => l.reduce((a, b) => a + b, 0) / l.length;
        const verschil = som(telbaar.slice(-4)) - som(telbaar.slice(-8, -4));
        richting = verschil > 2 ? "op" : verschil < -2 ? "af" : "gelijk";
      }
      return { spier, weken, gemiddeld, zone: volumeZone(gemiddeld), richting };
    })
    .filter((r) => r.weken.some((w) => w > 0))
    .sort((a, b) => b.gemiddeld - a.gemiddeld);
}

// ---------- Krachtniveau ----------

export type Niveau = "beginner" | "op_weg" | "gemiddeld" | "gevorderd" | "elite";
export const NIVEAU_LABELS: Record<Niveau, string> = {
  beginner: "Beginner",
  op_weg: "Op weg",
  gemiddeld: "Gemiddeld",
  gevorderd: "Gevorderd",
  elite: "Elite",
};
const NIVEAUS: Niveau[] = ["beginner", "op_weg", "gemiddeld", "gevorderd", "elite"];

/**
 * 1RM gedeeld door lichaamsgewicht vanaf waar een niveau begint (op_weg, gemiddeld, gevorderd,
 * elite); daaronder is het beginner. Afgeronde richtwaarden zoals coaches en veelgebruikte
 * krachttabellen ze geven, voor volwassenen tot ongeveer 40 jaar. Geen gemeten norm: zie
 * Wetenschap, #krachtniveau. Alleen de vier klassieke stanglifts; de trap bar deadlift telt als
 * deadlift (die is voor de meeste mensen iets zwaarder te tillen, dus hij valt eerder iets gunstig uit).
 */
export const KRACHTNORMEN: Record<string, { label: string; man: number[]; vrouw: number[] }> = {
  back_squat: { label: "Squat", man: [0.75, 1.25, 1.75, 2.5], vrouw: [0.5, 0.85, 1.25, 1.75] },
  bench_press: { label: "Bankdrukken", man: [0.5, 0.85, 1.25, 1.75], vrouw: [0.3, 0.5, 0.75, 1.1] },
  deadlift: { label: "Deadlift", man: [1.0, 1.5, 2.0, 2.75], vrouw: [0.6, 1.0, 1.5, 2.1] },
  trap_bar_deadlift: { label: "Deadlift (trap bar)", man: [1.0, 1.5, 2.0, 2.75], vrouw: [0.6, 1.0, 1.5, 2.1] },
  overhead_press: { label: "Overhead press", man: [0.35, 0.55, 0.8, 1.1], vrouw: [0.2, 0.35, 0.5, 0.7] },
};

export interface KrachtNiveau {
  label: string;
  niveau: Niveau;
  verhouding: number;
  /** Het volgende niveau en de 1RM die daarbij hoort; null op elite. */
  volgende: { niveau: Niveau; e1rm: number } | null;
}

export function krachtNiveau(
  sleutel: string,
  e1rm: number,
  lichaamsgewicht: number | null,
  geslacht: string | null,
): KrachtNiveau | null {
  const norm = KRACHTNORMEN[sleutel];
  if (!norm || !lichaamsgewicht || lichaamsgewicht <= 0 || (geslacht !== "man" && geslacht !== "vrouw")) return null;
  const grenzen = norm[geslacht];
  const verhouding = e1rm / lichaamsgewicht;
  let index = 0;
  grenzen.forEach((g, i) => {
    if (verhouding >= g) index = i + 1;
  });
  const volgendeGrens = grenzen[index];
  return {
    label: norm.label,
    niveau: NIVEAUS[index],
    verhouding: rond(verhouding, 2),
    volgende: volgendeGrens === undefined ? null : { niveau: NIVEAUS[index + 1], e1rm: rond(volgendeGrens * lichaamsgewicht) },
  };
}
