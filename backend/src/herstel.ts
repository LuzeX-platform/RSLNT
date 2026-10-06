// Pure logica voor de herstelcheck vóór de training (slaap, spierpijn, energie, kniepijn, 1–5).
// Bewust geen totaalscore: vier losse signalen, elk naast je eigen gemiddelde. Een slechte nacht
// en zere knieën zijn twee verschillende verhalen.

export const HERSTEL_ITEMS = {
  slaap: { label: "Slaap", hoogIsGoed: true },
  energie: { label: "Energie", hoogIsGoed: true },
  spierpijn: { label: "Spierpijn", hoogIsGoed: false },
  kniepijn: { label: "Kniepijn", hoogIsGoed: false },
} as const;
export type HerstelItem = keyof typeof HERSTEL_ITEMS;

export type HerstelWaarden = Record<HerstelItem, number>;

export type SignaalStatus = "goed" | "neutraal" | "let_op";

export interface Signaal {
  item: HerstelItem;
  label: string;
  waarde: number;
  status: SignaalStatus;
  /** Je gemiddelde over de vorige checks (niet de huidige), of null als er te weinig zijn. */
  gemiddelde: number | null;
}

export function status(item: HerstelItem, waarde: number): SignaalStatus {
  const gunstig = HERSTEL_ITEMS[item].hoogIsGoed ? waarde : 6 - waarde;
  return gunstig >= 4 ? "goed" : gunstig === 3 ? "neutraal" : "let_op";
}

/** @param eerder eerdere checks, nieuwste eerst (de huidige niet meegerekend) */
export function herstelSignalen(huidig: HerstelWaarden, eerder: HerstelWaarden[]): Signaal[] {
  const recent = eerder.slice(0, 28);
  return (Object.keys(HERSTEL_ITEMS) as HerstelItem[]).map((item) => ({
    item,
    label: HERSTEL_ITEMS[item].label,
    waarde: huidig[item],
    status: status(item, huidig[item]),
    gemiddelde:
      recent.length >= 3 ? Math.round((recent.reduce((som, c) => som + c[item], 0) / recent.length) * 10) / 10 : null,
  }));
}

/**
 * Herstel meerdere keren slecht? Dan is een deload eerder zinnig (zo staat het ook in je
 * programma). Regel: in minstens 2 van de laatste 3 checks twee of meer "let op"-signalen.
 * Een praktijkregel, geen gemeten grens.
 */
export function deloadOverwegen(checks: HerstelWaarden[]): boolean {
  const slecht = checks
    .slice(0, 3)
    .filter((c) => (Object.keys(HERSTEL_ITEMS) as HerstelItem[]).filter((i) => status(i, c[i]) === "let_op").length >= 2);
  return slecht.length >= 2;
}
