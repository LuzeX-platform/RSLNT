// Waar je pijn hebt. Per set (0–10) en in de herstelcheck (1–5) kies je optioneel een plek; de
// pijnregel in progressie.ts geldt voor de oefening waarbij je pijn meldt, waar die ook zit.

export const PIJN_PLEKKEN = {
  knie: "Knie",
  schouder: "Schouder",
  elleboog: "Elleboog",
  pols: "Pols",
  onderrug: "Onderrug",
  heup: "Heup",
  enkel: "Enkel",
  anders: "Anders",
} as const;

export type PijnPlek = keyof typeof PIJN_PLEKKEN;

export const PIJN_PLEK_SLEUTELS = Object.keys(PIJN_PLEKKEN) as [PijnPlek, ...PijnPlek[]];
