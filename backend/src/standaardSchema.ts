// Het startschema (A/B) en de oefeningen. Alleen gebruikt door de seed, en alleen als er nog
// geen schema's zijn: daarna beheer je alles in de app (Schema). Gewichtsstappen zijn de
// afgesproken standaard — dumbbells 2 kg (per dumbbell), kabel/machine/stang 2,5 kg — en per
// oefening aan te passen.

export interface StandaardOefening {
  naam: string;
  materiaal: "dumbbell" | "barbell" | "kabel" | "machine" | "lichaamsgewicht";
  gewichtsstap: number;
  perKant?: boolean;
}

export interface StandaardRegel {
  oefening: string;
  aantalSets: number;
  minSets: number;
  repsMin: number;
  repsMax: number;
  supersetGroep?: string;
}

export const STAP_PER_MATERIAAL: Record<StandaardOefening["materiaal"], number> = {
  dumbbell: 2,
  barbell: 2.5,
  kabel: 2.5,
  machine: 2.5,
  lichaamsgewicht: 0,
};

export const STANDAARD_OEFENINGEN: StandaardOefening[] = [
  { naam: "Goblet squat", materiaal: "dumbbell", gewichtsstap: 2 },
  { naam: "DB bench press", materiaal: "dumbbell", gewichtsstap: 2 },
  { naam: "Cable row", materiaal: "kabel", gewichtsstap: 2.5 },
  { naam: "Romanian deadlift", materiaal: "barbell", gewichtsstap: 2.5 },
  { naam: "DB shoulder press", materiaal: "dumbbell", gewichtsstap: 2 },
  { naam: "Calf raises", materiaal: "machine", gewichtsstap: 2.5 },
  { naam: "Dead bug", materiaal: "lichaamsgewicht", gewichtsstap: 0, perKant: true },
  { naam: "Trap bar deadlift", materiaal: "barbell", gewichtsstap: 2.5 },
  { naam: "Incline DB press", materiaal: "dumbbell", gewichtsstap: 2 },
  { naam: "Lat pulldown", materiaal: "kabel", gewichtsstap: 2.5 },
  { naam: "Bulgarian split squat", materiaal: "dumbbell", gewichtsstap: 2, perKant: true },
  { naam: "Leg curl", materiaal: "machine", gewichtsstap: 2.5 },
  { naam: "Lateral raises", materiaal: "dumbbell", gewichtsstap: 2 },
  { naam: "Biceps curl", materiaal: "dumbbell", gewichtsstap: 2 },
  { naam: "Triceps pushdown", materiaal: "kabel", gewichtsstap: 2.5 },
];

export const STANDAARD_SCHEMAS: { id: string; naam: string; regels: StandaardRegel[] }[] = [
  {
    id: "A",
    naam: "Training A",
    regels: [
      { oefening: "Goblet squat", aantalSets: 3, minSets: 3, repsMin: 8, repsMax: 10 },
      { oefening: "DB bench press", aantalSets: 3, minSets: 3, repsMin: 8, repsMax: 10 },
      { oefening: "Cable row", aantalSets: 3, minSets: 3, repsMin: 10, repsMax: 12 },
      { oefening: "Romanian deadlift", aantalSets: 3, minSets: 3, repsMin: 8, repsMax: 10 },
      { oefening: "DB shoulder press", aantalSets: 3, minSets: 3, repsMin: 8, repsMax: 10 },
      { oefening: "Calf raises", aantalSets: 3, minSets: 3, repsMin: 12, repsMax: 15 },
      { oefening: "Dead bug", aantalSets: 3, minSets: 3, repsMin: 8, repsMax: 10 },
    ],
  },
  {
    id: "B",
    naam: "Training B",
    regels: [
      { oefening: "Trap bar deadlift", aantalSets: 3, minSets: 3, repsMin: 6, repsMax: 8 },
      { oefening: "Incline DB press", aantalSets: 3, minSets: 3, repsMin: 8, repsMax: 10 },
      { oefening: "Lat pulldown", aantalSets: 3, minSets: 3, repsMin: 8, repsMax: 12 },
      { oefening: "Bulgarian split squat", aantalSets: 3, minSets: 3, repsMin: 8, repsMax: 10 },
      { oefening: "Leg curl", aantalSets: 3, minSets: 3, repsMin: 10, repsMax: 12 },
      { oefening: "Lateral raises", aantalSets: 3, minSets: 3, repsMin: 12, repsMax: 15 },
      { oefening: "Biceps curl", aantalSets: 3, minSets: 2, repsMin: 10, repsMax: 12, supersetGroep: "1" },
      { oefening: "Triceps pushdown", aantalSets: 3, minSets: 2, repsMin: 10, repsMax: 12, supersetGroep: "1" },
    ],
  },
];
