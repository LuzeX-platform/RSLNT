// Zet een oefening uit Free Exercise DB (https://github.com/yuhonas/free-exercise-db, publiek
// domein) om naar het formaat van RSLNT: onze spiersleutels, ons materiaal, een bewegingspatroon
// en een geschatte "knie-gevoelig". Puur, zodat de vertaalregels getest kunnen worden. Het
// resultaat staat in data/bibliotheek.json (bouwen: npm run bibliotheek -- <exercises.json>).
// Hoe we vertalen en waar dat schuurt, staat op de Wetenschap-pagina (#bibliotheek).

export const BRON_COMMIT = "f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5";
export const AFBEELDING_BASIS = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${BRON_COMMIT}/exercises/`;

export interface BronOefening {
  id: string;
  name: string;
  force: string | null;
  level: string;
  mechanic: string | null;
  equipment: string | null;
  primaryMuscles: string[];
  secondaryMuscles: string[];
  instructions: string[];
  category: string;
  images: string[];
}

export type Patroon =
  | "knie_dominant"
  | "heup_dominant"
  | "horizontaal_duwen"
  | "verticaal_duwen"
  | "horizontaal_trekken"
  | "verticaal_trekken"
  | "quad_isolatie"
  | "hamstring_curl"
  | "borst_isolatie"
  | "zijkant_schouder"
  | "achterkant_schouder"
  | "biceps"
  | "triceps"
  | "kuiten"
  | "buik"
  | "overig";

export interface BibliotheekOefening {
  id: string;
  naam: string;
  /** strength | stretching | plyometrics | powerlifting | olympic weightlifting | strongman | cardio */
  categorie: string;
  /** beginner | intermediate | expert */
  niveau: string;
  mechaniek: "compound" | "isolation" | null;
  kracht: "push" | "pull" | "static" | null;
  /** dumbbell | barbell | trap_bar | kabel | machine | lichaamsgewicht | kettlebell | band | overig */
  materiaal: string;
  spierenPrimair: string[];
  spierenSecundair: string[];
  patroon: Patroon;
  /** Geschat: hoofdspier voorkant bovenbeen, of een kniebuigende beweging. */
  knieGevoelig: boolean;
  unilateraal: boolean;
  gewichtsstap: number;
  /** Stappen in het Engels, zoals in de bron. */
  uitleg: string[];
  /** Paden onder AFBEELDING_BASIS. */
  afbeeldingen: string[];
}

/** Standaard kleinste gewichtsstap per materiaal (bij dumbbells per dumbbell). Aan te passen in Schema. */
export const STANDAARD_STAP: Record<string, number> = {
  dumbbell: 2,
  barbell: 2.5,
  trap_bar: 5,
  kabel: 2.5,
  machine: 5,
  lichaamsgewicht: 0,
  kettlebell: 4,
  band: 0,
  overig: 0,
};

const ZIJKANT = /lateral|side raise|upright (?:\w+ )?row|\by[- ]raise|iron cross/;
const ACHTERKANT = /rear|reverse fly|reverse flye|reverse machine fl|face pull|pull[- ]apart|bent[- ]over (?:dumbbell |low-pulley |cable )?(?:rear delt |lateral )?raise|reverse pec/;

/** "shoulders" splitst de bron niet op; wij wel, op naam en richting van de beweging. */
export function schouderdeel(naam: string, kracht: string | null, mechaniek: string | null): string {
  const n = naam.toLowerCase();
  if (ACHTERKANT.test(n)) return "rear_delts";
  if (ZIJKANT.test(n)) return "side_delts";
  if (kracht === "pull" && mechaniek === "compound") return "rear_delts";
  return "front_delts";
}

const SPIER: Record<string, string> = {
  quadriceps: "quads",
  hamstrings: "hamstrings",
  glutes: "glutes",
  calves: "calves",
  adductors: "adductors",
  abductors: "abductors",
  chest: "chest",
  triceps: "triceps",
  biceps: "biceps",
  forearms: "forearms",
  lats: "lats",
  "middle back": "upper_back",
  traps: "upper_back",
  "lower back": "lower_back",
  abdominals: "abs",
  neck: "neck",
};

export function spierSleutel(bron: string, o: Pick<BronOefening, "name" | "force" | "mechanic">): string {
  if (bron === "shoulders") return schouderdeel(o.name, o.force, o.mechanic);
  return SPIER[bron] ?? bron.replace(/\s+/g, "_");
}

export function materiaalVan(o: Pick<BronOefening, "name" | "equipment">): string {
  if (/trap bar|hex bar/i.test(o.name)) return "trap_bar";
  switch (o.equipment) {
    case "barbell":
    case "e-z curl bar":
      return "barbell";
    case "dumbbell":
      return "dumbbell";
    case "cable":
      return "kabel";
    case "machine":
      return "machine";
    case "body only":
    case null:
      return "lichaamsgewicht";
    case "kettlebells":
      return "kettlebell";
    case "bands":
      return "band";
    default:
      return "overig";
  }
}

const UNILATERAAL = /one[- ]arm|one[- ]leg|single[- ]arm|single[- ]leg|alternat|lunge|split squat|step[- ]?up|unilateral|pistol|kneeling .*one/;
/** Explosieve en samengestelde oefeningen: wel in de bibliotheek, niet in een gegenereerd schema. */
const EXPLOSIEF = /snatch|clean|jerk|get-up|halo|thruster|battling|sled|pirate|jammer|anti-gravity/;
const KNIEBEWEGING = /squat|lunge|step[- ]?up|leg press|leg extension|pistol|sissy|\bjump|hop\b|bound|skater/;

export function patroonVan(o: {
  naam: string;
  categorie: string;
  mechaniek: string | null;
  spierenPrimair: string[];
}): Patroon {
  if (o.categorie !== "strength" && o.categorie !== "powerlifting") return "overig";
  const n = o.naam.toLowerCase();
  if (EXPLOSIEF.test(n)) return "overig";
  const p = new Set(o.spierenPrimair);
  if (p.has("calves") || /calf raise/.test(n)) return "kuiten";
  if (p.has("abs")) return "buik";
  if (p.has("quads")) return o.mechaniek === "isolation" || /leg extension/.test(n) ? "quad_isolatie" : "knie_dominant";
  if (p.has("hamstrings")) return /curl/.test(n) ? "hamstring_curl" : "heup_dominant";
  if (p.has("glutes") || p.has("lower_back")) return "heup_dominant";
  if (p.has("chest")) {
    return o.mechaniek === "isolation" || /fly|flye|crossover|pec deck|butterfly/.test(n) ? "borst_isolatie" : "horizontaal_duwen";
  }
  if (p.has("lats")) return /row/.test(n) ? "horizontaal_trekken" : "verticaal_trekken";
  if (p.has("upper_back")) {
    if (/shrug/.test(n)) return "overig";
    if (/upright/.test(n)) return "zijkant_schouder";
    if (/fly|flye|raise|face pull|pull[- ]apart/.test(n)) return "achterkant_schouder";
    return "horizontaal_trekken";
  }
  if (p.has("side_delts")) return "zijkant_schouder";
  if (p.has("rear_delts")) return "achterkant_schouder";
  if (p.has("front_delts")) return o.mechaniek === "compound" || /press/.test(n) ? "verticaal_duwen" : "overig";
  if (p.has("biceps")) return "biceps";
  if (p.has("triceps")) return "triceps";
  return "overig";
}

const uniek = (lijst: string[]) => [...new Set(lijst)];

export function omzetten(o: BronOefening): BibliotheekOefening {
  const spierenPrimair = uniek(o.primaryMuscles.map((s) => spierSleutel(s, o)));
  const spierenSecundair = uniek(o.secondaryMuscles.map((s) => spierSleutel(s, o))).filter((s) => !spierenPrimair.includes(s));
  const materiaal = materiaalVan(o);
  const mechaniek = o.mechanic === "compound" || o.mechanic === "isolation" ? o.mechanic : null;
  const kracht = o.force === "push" || o.force === "pull" || o.force === "static" ? o.force : null;
  const n = o.name.toLowerCase();
  return {
    id: o.id,
    naam: o.name.trim(),
    categorie: o.category,
    niveau: o.level,
    mechaniek,
    kracht,
    materiaal,
    spierenPrimair,
    spierenSecundair,
    patroon: patroonVan({ naam: o.name, categorie: o.category, mechaniek, spierenPrimair }),
    knieGevoelig: o.category !== "stretching" && (spierenPrimair.includes("quads") || KNIEBEWEGING.test(n)),
    unilateraal: UNILATERAAL.test(n),
    gewichtsstap: STANDAARD_STAP[materiaal] ?? 0,
    uitleg: o.instructions.map((s) => s.trim()).filter(Boolean),
    afbeeldingen: o.images,
  };
}
