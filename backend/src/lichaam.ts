// Pure logica voor het gezondheidsmenu. Elke formule staat met bron op de Wetenschap-pagina
// (#lichaam tot en met #eiwit, en #rekenregels); verander je hier iets, werk die dan ook bij.

import { naarDatum, verschuifDag } from "./datum.js";
import type { Meting } from "./gewicht.js";

export type Geslacht = "man" | "vrouw";

/** Gangbare activiteitsfactoren voor het dagelijks verbruik (BMR × factor). */
export const ACTIVITEIT = {
  sedentair: { factor: 1.2, uitleg: "zittend werk, weinig beweging" },
  licht: { factor: 1.375, uitleg: "zittend werk, 2–3× per week trainen" },
  matig: { factor: 1.55, uitleg: "veel lopen of 3–5× per week trainen" },
  zwaar: { factor: 1.725, uitleg: "lichamelijk werk of 6–7× per week trainen" },
  zeer_zwaar: { factor: 1.9, uitleg: "zwaar lichamelijk werk én dagelijks trainen" },
} as const;
export type Activiteit = keyof typeof ACTIVITEIT;

const rond = (waarde: number, decimalen = 1) => Math.round(waarde * 10 ** decimalen) / 10 ** decimalen;

// ---------- Lengte en gewicht ----------

export function bmi(kg: number, lengteCm: number): number {
  const m = lengteCm / 100;
  return rond(kg / (m * m));
}

/** WHO-indeling. Zegt bij veel spiermassa weinig: dat staat er in de app bij. */
export function bmiCategorie(waarde: number): string {
  if (waarde < 18.5) return "ondergewicht";
  if (waarde < 25) return "gezond gewicht";
  if (waarde < 30) return "overgewicht";
  return "obesitas";
}

/** Taille gedeeld door lengte. Onder 0,5 is het advies (NICE 2022). */
export function tailleLengte(tailleCm: number, lengteCm: number): { ratio: number; oordeel: string } {
  const ratio = rond(tailleCm / lengteCm, 2);
  const oordeel = ratio < 0.5 ? "gezond" : ratio < 0.6 ? "verhoogd" : "hoog";
  return { ratio, oordeel };
}

// ---------- Vetpercentage en vetvrije massa ----------

/**
 * Vetpercentage geschat uit omtrekmaten (US Navy, Hodgdon & Beckett 1984), metrische versie.
 * Mannen: taille en nek. Vrouwen: taille, heup en nek. Ongeldige maten → null.
 */
export function vetNavy(m: {
  geslacht: Geslacht;
  lengteCm: number;
  tailleCm: number;
  nekCm: number;
  heupCm?: number | null;
}): number | null {
  const { geslacht, lengteCm, tailleCm, nekCm, heupCm } = m;
  let dichtheid: number;
  if (geslacht === "man") {
    if (tailleCm <= nekCm) return null;
    dichtheid = 1.0324 - 0.19077 * Math.log10(tailleCm - nekCm) + 0.15456 * Math.log10(lengteCm);
  } else {
    if (!heupCm || tailleCm + heupCm <= nekCm) return null;
    dichtheid = 1.29579 - 0.35004 * Math.log10(tailleCm + heupCm - nekCm) + 0.221 * Math.log10(lengteCm);
  }
  const vet = 495 / dichtheid - 450;
  return vet > 2 && vet < 60 ? rond(vet) : null;
}

export function vetvrijeMassa(kg: number, vetpercentage: number): number {
  return rond(kg * (1 - vetpercentage / 100));
}

/**
 * Fat-free mass index en de voor lengte genormaliseerde versie (Kouri et al. 1995):
 * FFMI + 6,1 × (1,8 − lengte in m). Bij lange mensen valt die lager uit dan de gewone FFMI.
 */
export function ffmi(vetvrijeKg: number, lengteCm: number): { ffmi: number; genormaliseerd: number } {
  const m = lengteCm / 100;
  const waarde = vetvrijeKg / (m * m);
  return { ffmi: rond(waarde), genormaliseerd: rond(waarde + 6.1 * (1.8 - m)) };
}

// ---------- Energie ----------

export function leeftijd(geboortedatum: string, dag: string): number {
  const geboren = naarDatum(geboortedatum);
  const nu = naarDatum(dag);
  let jaren = nu.getUTCFullYear() - geboren.getUTCFullYear();
  const nogNietJarig =
    nu.getUTCMonth() < geboren.getUTCMonth() ||
    (nu.getUTCMonth() === geboren.getUTCMonth() && nu.getUTCDate() < geboren.getUTCDate());
  if (nogNietJarig) jaren--;
  return jaren;
}

/** Rustverbruik volgens Mifflin-St Jeor (1990), in kcal per dag. */
export function bmrMifflin(m: { kg: number; lengteCm: number; leeftijd: number; geslacht: Geslacht }): number {
  return Math.round(10 * m.kg + 6.25 * m.lengteCm - 5 * m.leeftijd + (m.geslacht === "man" ? 5 : -161));
}

/** Rustverbruik volgens Katch-McArdle, uit vetvrije massa. Beter als je vetpercentage klopt. */
export function bmrKatch(vetvrijeKg: number): number {
  return Math.round(370 + 21.6 * vetvrijeKg);
}

export function dagverbruik(bmr: number, activiteit: Activiteit): number {
  return Math.round(bmr * ACTIVITEIT[activiteit].factor);
}

/**
 * Calorieën om aan te komen: +5 tot +15% boven onderhoud (Helms 2023 vergeleek precies die
 * twee; Iraki 2019 adviseert 5–20%). Startpunt +10%; bijsturen op je gewichtstrend.
 */
export function calorieDoel(onderhoud: number): { onderhoud: number; start: number; min: number; max: number } {
  return {
    onderhoud,
    start: Math.round((onderhoud * 1.1) / 10) * 10,
    min: Math.round((onderhoud * 1.05) / 10) * 10,
    max: Math.round((onderhoud * 1.15) / 10) * 10,
  };
}

/** 1,6–2,2 g eiwit per kg per dag (Morton 2018). */
export function eiwitDoel(kg: number): { min: number; max: number } {
  return { min: Math.round(kg * 1.6), max: Math.round(kg * 2.2) };
}

// ---------- Tempo en doel ----------

/**
 * Tempo in kg per week: de helling van een rechte lijn door je wegingen van de laatste
 * `dagen` dagen (kleinste kwadraten). Ruis van één weging telt zo minder dan bij "nu min toen".
 * Minstens drie wegingen over minstens zeven dagen, anders null.
 */
export function trendKgPerWeek(metingen: Meting[], totEnMet: string, dagen = 28): number | null {
  const vanaf = verschuifDag(totEnMet, -(dagen - 1));
  const punten = metingen
    .filter((m) => m.datum >= vanaf && m.datum <= totEnMet)
    .map((m) => ({ x: (naarDatum(m.datum).getTime() - naarDatum(vanaf).getTime()) / 86400000, y: m.gewicht }));
  if (punten.length < 3) return null;
  const xs = punten.map((p) => p.x);
  if (Math.max(...xs) - Math.min(...xs) < 7) return null;
  const n = punten.length;
  const gemX = xs.reduce((a, b) => a + b, 0) / n;
  const gemY = punten.reduce((a, p) => a + p.y, 0) / n;
  const teller = punten.reduce((a, p) => a + (p.x - gemX) * (p.y - gemY), 0);
  const noemer = punten.reduce((a, p) => a + (p.x - gemX) ** 2, 0);
  return rond((teller / noemer) * 7, 2);
}

export type TempoOordeel = "te_langzaam" | "op_koers" | "te_snel" | "onbekend";

/** Je tempo naast je doeltempo, met een kleine calorie-bijsturing (geen grote sprongen). */
export function tempoAdvies(trend: number | null, tempoMin: number, tempoMax: number): { oordeel: TempoOordeel; advies: string } {
  if (trend === null) {
    return { oordeel: "onbekend", advies: "Weeg je een paar keer per week; na een week of twee zie je hier je tempo." };
  }
  if (trend < tempoMin) {
    return { oordeel: "te_langzaam", advies: "Langzamer dan je doel. Eet ongeveer 100–150 kcal per dag meer en kijk over twee weken opnieuw." };
  }
  if (trend > tempoMax) {
    return { oordeel: "te_snel", advies: "Sneller dan je doel: de kans is groot dat het extra vooral vet is. Eet ongeveer 100–150 kcal per dag minder." };
  }
  return { oordeel: "op_koers", advies: "Precies binnen je doeltempo. Zo doorgaan." };
}

/** Wanneer je je doelgewicht haalt bij het snelste en langzaamste doeltempo. */
export function tijdlijn(
  huidig: number,
  doel: number,
  tempoMin: number,
  tempoMax: number,
  dag: string,
): { nogKg: number; vroegst: string; uiterlijk: string; wekenMin: number; wekenMax: number } | null {
  const nogKg = rond(doel - huidig);
  if (nogKg <= 0 || tempoMin <= 0 || tempoMax <= 0) return null;
  const wekenMin = Math.ceil(nogKg / tempoMax);
  const wekenMax = Math.ceil(nogKg / tempoMin);
  return {
    nogKg,
    wekenMin,
    wekenMax,
    vroegst: verschuifDag(dag, wekenMin * 7),
    uiterlijk: verschuifDag(dag, wekenMax * 7),
  };
}

/** Het aanbevolen tempo uit onderzoek: 0,25–0,5% van je lichaamsgewicht per week (Iraki 2019). */
export function aanbevolenTempo(kg: number): { min: number; max: number } {
  return { min: rond(kg * 0.0025, 2), max: rond(kg * 0.005, 2) };
}
