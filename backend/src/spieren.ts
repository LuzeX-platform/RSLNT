// Nederlandse namen van spiergroepen. Een programmabestand kan er eigen labels bij geven
// (muscle_labels_nl); die gaan voor.

export const SPIER_LABELS: Record<string, string> = {
  quads: "Voorkant bovenbeen",
  glutes: "Billen",
  hamstrings: "Achterkant bovenbeen",
  calves: "Kuiten",
  adductors: "Binnenkant bovenbeen",
  chest: "Borst",
  front_delts: "Voorkant schouders",
  side_delts: "Zijkant schouders",
  rear_delts: "Achterkant schouders",
  triceps: "Triceps",
  biceps: "Biceps",
  forearms: "Onderarmen",
  lats: "Brede rugspier",
  upper_back: "Bovenrug",
  lower_back: "Onderrug",
  abs: "Buikspieren",
};

export function spierLabels(bron: unknown): Record<string, string> {
  const eigen = (bron as { muscle_labels_nl?: Record<string, string> } | null)?.muscle_labels_nl;
  return { ...SPIER_LABELS, ...(eigen && typeof eigen === "object" ? eigen : {}) };
}

/** Het doel uit een programmabestand (program.goal), als dat er is. */
export function programmaDoel(bron: unknown): { gewicht: number | null; tempoMin: number | null; tempoMax: number | null } {
  const doel = (bron as { program?: { goal?: { bodyweight_target_kg?: unknown; rate_kg_per_week?: unknown } } } | null)?.program?.goal;
  const tempo = Array.isArray(doel?.rate_kg_per_week) ? doel.rate_kg_per_week : [];
  const getal = (w: unknown) => (typeof w === "number" && Number.isFinite(w) ? w : null);
  return { gewicht: getal(doel?.bodyweight_target_kg), tempoMin: getal(tempo[0]), tempoMax: getal(tempo[1]) };
}
