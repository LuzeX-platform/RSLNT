// Pure logica (Pro): het pijnlogboek. Brengt bij elkaar wat je al invult — pijn per set, de
// pijntjes uit je herstelcheck — en je eigen notities, per plek en per week. Alleen tellen en
// ordenen; geen diagnose en geen advies dat verder gaat dan de pijnregel (progressie.ts).

import { PIJN_PLEKKEN } from "./pijn.js";
import { verschuifDag } from "./datum.js";

export interface PijnSet {
  dag: string;
  oefening: string;
  pijn: number;
  plek: string | null;
}

export interface PijnCheck {
  dag: string;
  /** 1–5 */
  pijn: number;
  plekken: string[];
}

export interface PlekOverzicht {
  plek: string;
  label: string;
  /** Hoogste pijn per week uit je sets (0–10), oudste eerst; null = die week niets ingevuld. */
  perWeek: (number | null)[];
  /** Dagen waarop je herstelcheck pijntjes hier aangaf. */
  checkDagen: number;
  laatst: string;
  oefeningen: { naam: string; keer: number; max: number; laatst: string }[];
  /** Laatste 2 weken tegen de 2 daarvoor (hoogste pijn): 2 punten verschil telt. */
  richting: "beter" | "slechter" | "gelijk" | null;
}

const plekLabel = (plek: string) => (plek in PIJN_PLEKKEN ? PIJN_PLEKKEN[plek as keyof typeof PIJN_PLEKKEN] : "Niet gezegd");

/** @param weken aantal blokken van 7 dagen, het laatste eindigt vandaag */
export function pijnOverzicht(sets: PijnSet[], checks: PijnCheck[], vandaag: string, weken = 12): PlekOverzicht[] {
  const vanaf = verschuifDag(vandaag, -(weken * 7 - 1));
  const blok = (dag: string) => Math.floor((Date.parse(`${dag}T12:00:00Z`) - Date.parse(`${vanaf}T12:00:00Z`)) / (7 * 86400000));
  const perPlek = new Map<string, PlekOverzicht>();
  const rij = (plek: string) => {
    let r = perPlek.get(plek);
    if (!r) {
      r = { plek, label: plekLabel(plek), perWeek: Array(weken).fill(null), checkDagen: 0, laatst: "", oefeningen: [], richting: null };
      perPlek.set(plek, r);
    }
    return r;
  };
  for (const s of sets) {
    if (s.dag < vanaf || s.dag > vandaag || s.pijn <= 0) continue;
    const r = rij(s.plek ?? "onbekend");
    const b = blok(s.dag);
    r.perWeek[b] = Math.max(r.perWeek[b] ?? 0, s.pijn);
    if (s.dag > r.laatst) r.laatst = s.dag;
    let o = r.oefeningen.find((x) => x.naam === s.oefening);
    if (!o) r.oefeningen.push((o = { naam: s.oefening, keer: 0, max: 0, laatst: "" }));
    o.keer += 1;
    o.max = Math.max(o.max, s.pijn);
    if (s.dag > o.laatst) o.laatst = s.dag;
  }
  for (const c of checks) {
    if (c.dag < vanaf || c.dag > vandaag || c.pijn < 2) continue;
    for (const plek of c.plekken) {
      const r = rij(plek);
      r.checkDagen += 1;
      if (c.dag > r.laatst) r.laatst = c.dag;
    }
  }
  for (const r of perPlek.values()) {
    r.oefeningen.sort((a, b) => b.max - a.max || b.keer - a.keer);
    const max = (l: (number | null)[]) => (l.some((w) => w !== null) ? Math.max(...l.map((w) => w ?? 0)) : null);
    const nu = max(r.perWeek.slice(-2));
    const ervoor = max(r.perWeek.slice(-4, -2));
    if (ervoor !== null) {
      const v = (nu ?? 0) - ervoor;
      r.richting = v <= -2 ? "beter" : v >= 2 ? "slechter" : "gelijk";
    }
  }
  return [...perPlek.values()].sort((a, b) => b.laatst.localeCompare(a.laatst));
}
