// De schemagenerator van het personalisatiemenu: voorkeuren → een programmabestand
// (schema_version 1), precies het formaat dat je ook zelf kunt inladen. Puur, zonder database:
// de route geeft mee welke oefeningen er al zijn, zodat je geschiedenis bij dezelfde sleutel blijft.
//
// Stappen:
//   1. split kiezen op aantal dagen (full body, boven/onder, push/pull/benen);
//   2. per training de bewegingspatronen vullen met een oefening die past bij je materiaal,
//      blessures, niveau en favorieten (en niet twee keer dezelfde in een week als het anders kan);
//   3. sets verdelen: eerst inkorten tot het past in je tijd, dan aanvullen waar een spiergroep
//      onder het weekdoel blijft, nooit boven ~11 sets per spier per training;
//   4. reps, RIR en rust per doel.
// Alle getallen en waarom staan op de Wetenschap-pagina (#personaliseren).

import type { BibliotheekOefening, Patroon } from "./bibliotheekOmzetten.js";
import { CATALOGUS, type CatalogusOefening } from "./catalogus.js";
import { ALLE_SPIER_LABELS, SPIER_LABELS } from "./spieren.js";
import { fractioneleSets, SETS_PER_TRAINING_GRENS } from "./voortgang.js";

export type Doel = "spiermassa" | "kracht" | "vetverlies" | "fit";
export type Ervaring = "beginner" | "gevorderd" | "ervaren";
export type Blessure = "knie" | "schouder" | "rug";

export const DOELEN: Record<Doel, string> = {
  spiermassa: "Spiermassa opbouwen",
  kracht: "Sterker worden",
  vetverlies: "Vet verliezen, spier behouden",
  fit: "Fit en gezond blijven",
};
export const ERVARING: Record<Ervaring, string> = {
  beginner: "Minder dan een jaar",
  gevorderd: "1–3 jaar",
  ervaren: "Meer dan 3 jaar",
};
export const BLESSURES: Record<Blessure, string> = { knie: "Knie", schouder: "Schouder", rug: "Onderrug" };
/** Wat je kunt kiezen bij materiaal. Lichaamsgewicht kan altijd. */
export const MATERIAAL_KEUZES: Record<string, string> = {
  dumbbell: "Dumbbells en een bank",
  barbell: "Stang met schijven en een rek",
  trap_bar: "Trap bar",
  kabel: "Kabelstation",
  machine: "Machines",
  kettlebell: "Kettlebells",
  band: "Weerstandsbanden",
  stang: "Optrek- of dipstang",
  overig: "Fitnessbal en ab roller",
};

export interface Voorkeuren {
  doel: Doel;
  ervaring: Ervaring;
  dagenPerWeek: number;
  minutenPerTraining: number;
  materiaal: string[];
  blessures: Blessure[];
  /** Bibliotheek-id's. */
  favorieten: string[];
  /** Bibliotheek-id's. */
  uitgesloten: string[];
  /** Spiersleutels die extra aandacht krijgen. */
  focus: string[];
}

/** Een oefening die al in de database staat. */
export interface BestaandeOefening {
  sleutel: string;
  naam: string;
  materiaal: string;
  gewichtsstap: number;
  perKant: boolean;
  spierenPrimair: string[];
  spierenSecundair: string[];
  mechaniek: string | null;
  unilateraal: boolean;
  knieGevoelig: boolean;
  alternatieven: string[];
  bibliotheekId: string | null;
  /** Al eens gelogd: dan heeft de oefening voorrang, zodat je opbouw doorloopt. */
  heeftGeschiedenis: boolean;
}

export interface GeneratorInvoer {
  voorkeuren: Voorkeuren;
  bestaand: BestaandeOefening[];
  /** Oefeningen uit de bibliotheek die favoriet zijn (de rest is niet nodig). */
  bibliotheekFavorieten: BibliotheekOefening[];
  dag: string;
  doelLichaam?: { startKg: number | null; doelKg: number | null; tempo: [number, number] | null };
}

// ---------- Splits ----------

type Prioriteit = 1 | 2 | 3;
interface Slot {
  patroon: Patroon;
  prioriteit: Prioriteit;
}
interface SessieSjabloon {
  code: string;
  naam: string;
  slots: Slot[];
}
interface Split {
  naam: string;
  uitleg: string;
  sessies: SessieSjabloon[];
}

const s = (patroon: Patroon, prioriteit: Prioriteit): Slot => ({ patroon, prioriteit });

export function kiesSplit(dagen: number): Split {
  if (dagen <= 2) {
    return {
      naam: "Full body 2×",
      uitleg: "Twee keer per week je hele lichaam: elke spiergroep twee keer per week.",
      sessies: [
        { code: "A", naam: "Full body A", slots: [s("knie_dominant", 1), s("horizontaal_duwen", 1), s("verticaal_trekken", 1), s("hamstring_curl", 2), s("zijkant_schouder", 2), s("triceps", 2), s("kuiten", 3), s("buik", 3)] },
        { code: "B", naam: "Full body B", slots: [s("heup_dominant", 1), s("horizontaal_trekken", 1), s("horizontaal_duwen", 1), s("knie_dominant", 2), s("achterkant_schouder", 2), s("biceps", 2), s("zijkant_schouder", 3), s("buik", 3)] },
      ],
    };
  }
  if (dagen === 3) {
    return {
      naam: "Full body 3×",
      uitleg: "Drie keer per week je hele lichaam: elke spiergroep twee tot drie keer per week, met per training minder sets per spier.",
      sessies: [
        { code: "A", naam: "Full body A", slots: [s("knie_dominant", 1), s("horizontaal_duwen", 1), s("verticaal_trekken", 1), s("hamstring_curl", 2), s("zijkant_schouder", 2), s("biceps", 3), s("kuiten", 3)] },
        { code: "B", naam: "Full body B", slots: [s("heup_dominant", 1), s("horizontaal_trekken", 1), s("horizontaal_duwen", 1), s("quad_isolatie", 2), s("achterkant_schouder", 2), s("triceps", 2), s("buik", 3)] },
        { code: "C", naam: "Full body C", slots: [s("knie_dominant", 1), s("verticaal_duwen", 1), s("horizontaal_trekken", 1), s("heup_dominant", 2), s("borst_isolatie", 2), s("zijkant_schouder", 2), s("kuiten", 3), s("biceps", 3), s("buik", 3)] },
      ],
    };
  }
  if (dagen === 4) {
    return {
      naam: "Boven / onder 4×",
      uitleg: "Twee trainingen voor je bovenlichaam en twee voor je benen: elke spiergroep twee keer per week.",
      sessies: [
        { code: "A", naam: "Bovenlichaam A", slots: [s("horizontaal_duwen", 1), s("horizontaal_trekken", 1), s("verticaal_duwen", 2), s("verticaal_trekken", 2), s("zijkant_schouder", 2), s("biceps", 3), s("triceps", 3)] },
        { code: "B", naam: "Onderlichaam A", slots: [s("knie_dominant", 1), s("heup_dominant", 1), s("hamstring_curl", 2), s("quad_isolatie", 2), s("kuiten", 2), s("buik", 3)] },
        { code: "C", naam: "Bovenlichaam B", slots: [s("verticaal_trekken", 1), s("horizontaal_duwen", 1), s("horizontaal_trekken", 2), s("borst_isolatie", 2), s("achterkant_schouder", 2), s("zijkant_schouder", 2), s("triceps", 3), s("biceps", 3)] },
        { code: "D", naam: "Onderlichaam B", slots: [s("heup_dominant", 1), s("knie_dominant", 1), s("hamstring_curl", 2), s("kuiten", 2), s("buik", 3)] },
      ],
    };
  }
  if (dagen === 5) {
    return {
      naam: "Boven / onder + push / pull / benen",
      uitleg: "Vijf trainingen: boven, onder, push, pull en benen. Elke spiergroep twee keer per week.",
      sessies: [
        { code: "A", naam: "Bovenlichaam", slots: [s("horizontaal_duwen", 1), s("horizontaal_trekken", 1), s("verticaal_duwen", 2), s("verticaal_trekken", 2), s("zijkant_schouder", 3), s("biceps", 3), s("triceps", 3)] },
        { code: "B", naam: "Onderlichaam", slots: [s("knie_dominant", 1), s("heup_dominant", 1), s("hamstring_curl", 2), s("kuiten", 2), s("buik", 3)] },
        { code: "C", naam: "Push", slots: [s("horizontaal_duwen", 1), s("verticaal_duwen", 1), s("borst_isolatie", 2), s("zijkant_schouder", 2), s("triceps", 2)] },
        { code: "D", naam: "Pull", slots: [s("verticaal_trekken", 1), s("horizontaal_trekken", 1), s("achterkant_schouder", 2), s("biceps", 2), s("buik", 3)] },
        { code: "E", naam: "Benen", slots: [s("knie_dominant", 1), s("heup_dominant", 1), s("quad_isolatie", 2), s("hamstring_curl", 2), s("kuiten", 2)] },
      ],
    };
  }
  const push = (code: string, naam: string): SessieSjabloon => ({ code, naam, slots: [s("horizontaal_duwen", 1), s("verticaal_duwen", 1), s("borst_isolatie", 2), s("zijkant_schouder", 2), s("triceps", 2)] });
  const pull = (code: string, naam: string): SessieSjabloon => ({ code, naam, slots: [s("verticaal_trekken", 1), s("horizontaal_trekken", 1), s("achterkant_schouder", 2), s("biceps", 2), s("buik", 3)] });
  const benen = (code: string, naam: string): SessieSjabloon => ({ code, naam, slots: [s("knie_dominant", 1), s("heup_dominant", 1), s("hamstring_curl", 2), s("quad_isolatie", 2), s("kuiten", 2), s("buik", 3)] });
  return {
    naam: "Push / pull / benen 2×",
    uitleg: "Zes trainingen: push, pull en benen, twee keer per week. Elke spiergroep twee keer per week.",
    sessies: [push("A", "Push A"), pull("B", "Pull A"), benen("C", "Benen A"), push("D", "Push B"), pull("E", "Pull B"), benen("F", "Benen B")],
  };
}

// ---------- Volume, reps, rust ----------

const BASIS_VOLUME: Record<Doel, Record<Ervaring, number>> = {
  spiermassa: { beginner: 10, gevorderd: 12, ervaren: 15 },
  kracht: { beginner: 8, gevorderd: 10, ervaren: 12 },
  vetverlies: { beginner: 8, gevorderd: 10, ervaren: 12 },
  fit: { beginner: 6, gevorderd: 8, ervaren: 8 },
};

/** Spiergroepen met een weekdoel, als fractie van het basisvolume. Kleine spieren krijgen al veel indirect werk. */
const VOLUME_FACTOR: Record<string, number> = {
  quads: 1,
  glutes: 1,
  hamstrings: 1,
  chest: 1,
  lats: 1,
  upper_back: 1,
  side_delts: 1,
  rear_delts: 0.8,
  biceps: 0.8,
  triceps: 0.8,
  calves: 0.8,
  abs: 0.6,
};
const FOCUS_FACTOR = 1.3;

export function weekdoelen(v: Pick<Voorkeuren, "doel" | "ervaring" | "focus">): Record<string, number> {
  const basis = BASIS_VOLUME[v.doel][v.ervaring];
  const doelen: Record<string, number> = {};
  for (const [spier, factor] of Object.entries(VOLUME_FACTOR)) {
    doelen[spier] = Math.round(basis * factor * (v.focus.includes(spier) ? FOCUS_FACTOR : 1));
  }
  return doelen;
}

interface Uitvoering {
  repMin: number;
  repMax: number;
  rir: number;
  rust: number;
}

export function uitvoering(
  v: Pick<Voorkeuren, "doel" | "ervaring" | "blessures">,
  o: { mechaniek: string; patroon: Patroon; hoofdlift: boolean; knieGevoelig: boolean },
  prioriteit: Prioriteit,
): Uitvoering {
  const compound = o.mechaniek === "compound";
  const groot = compound && prioriteit === 1;
  let u: Uitvoering;
  switch (v.doel) {
    case "kracht":
      u = o.hoofdlift && groot ? { repMin: 4, repMax: 6, rir: 2, rust: 180 } : compound ? { repMin: 6, repMax: 10, rir: 2, rust: 150 } : { repMin: 10, repMax: 15, rir: 1, rust: 90 };
      break;
    case "fit":
      u = compound ? { repMin: 8, repMax: 12, rir: 3, rust: 90 } : { repMin: 12, repMax: 15, rir: 2, rust: 60 };
      break;
    case "vetverlies":
      u = compound ? { repMin: 6, repMax: 10, rir: 2, rust: 120 } : { repMin: 10, repMax: 15, rir: 1, rust: 60 };
      break;
    default:
      u = groot ? { repMin: 6, repMax: 10, rir: 2, rust: 150 } : compound ? { repMin: 8, repMax: 12, rir: 2, rust: 120 } : { repMin: 10, repMax: 15, rir: 1, rust: 75 };
  }
  if (o.patroon === "zijkant_schouder" || o.patroon === "achterkant_schouder") u = { ...u, repMin: Math.max(u.repMin, 12), repMax: Math.max(u.repMax, 15) };
  // Beginners: wat meer reps en ruimte over, techniek eerst.
  if (v.ervaring === "beginner") u = { ...u, repMin: Math.max(u.repMin, 8), repMax: Math.max(u.repMax, 12), rir: Math.min(u.rir + 1, 3) };
  // Gevoelige knie: lichter gewicht (meer reps) en meer over op kniebelastende oefeningen.
  if (v.blessures.includes("knie") && o.knieGevoelig) u = { ...u, repMin: Math.max(u.repMin, 10), repMax: Math.max(u.repMax, 15), rir: Math.min(u.rir + 1, 3) };
  if (u.repMax < u.repMin + 2) u = { ...u, repMax: u.repMin + 2 };
  return u;
}

/** Kortste rust die we voorstellen (Singer 2024: boven ~90 s geen meetbaar verschil voor spiergroei). Voor kracht langer. */
export function minimaleRust(doel: Doel, r: { patroon: Patroon; prioriteit: number }): number {
  const groot = COMPOUND_PATRONEN.includes(r.patroon);
  if (doel === "kracht") return groot ? (r.prioriteit === 1 ? 180 : 120) : 90;
  return groot ? 90 : 60;
}

// ---------- Tijd ----------

export const OPWARMEN_MINUTEN = 8;
const WERK_SECONDEN = 45;
const WISSEL_MINUTEN = 1;

export function minutenVoor(regels: { sets: number; rust: number; perKant: boolean }[]): number {
  let totaal = OPWARMEN_MINUTEN;
  for (const r of regels) {
    const werk = r.perKant ? WERK_SECONDEN * 2 : WERK_SECONDEN;
    totaal += WISSEL_MINUTEN + (r.sets * werk + (r.sets - 1) * r.rust) / 60 + r.rust / 60;
  }
  return Math.round(totaal);
}

// ---------- Kandidaten ----------

interface Kandidaat {
  sleutel: string;
  naam: string;
  bibliotheekId: string | null;
  patroon: Patroon;
  materiaal: string;
  nodig: string[];
  mechaniek: "compound" | "isolation";
  spierenPrimair: string[];
  spierenSecundair: string[];
  gewichtsstap: number;
  perKant: boolean;
  unilateraal: boolean;
  knieGevoelig: boolean;
  schouderBelastend: boolean;
  rugBelastend: boolean;
  niveau: number;
  hoofdlift: boolean;
  cue: string;
  favoriet: boolean;
  bekend: boolean;
  alternatievenBestaand: string[];
  volgorde: number;
}

const slug = (tekst: string) =>
  tekst.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "oefening";

function kandidaten(invoer: GeneratorInvoer): Kandidaat[] {
  const { voorkeuren, bestaand, bibliotheekFavorieten } = invoer;
  const perSleutel = new Map(bestaand.map((b) => [b.sleutel, b]));
  const perNaam = new Map(bestaand.map((b) => [b.naam.toLowerCase(), b]));
  const perBibliotheek = new Map(bestaand.filter((b) => b.bibliotheekId).map((b) => [b.bibliotheekId!, b]));
  const favoriet = new Set(voorkeuren.favorieten);

  // Wat er al in de database staat gaat voor: zo overschrijft een import niets wat je zelf aanpaste.
  const metBestaand = (k: Kandidaat, b: BestaandeOefening | undefined): Kandidaat =>
    b
      ? {
          ...k,
          sleutel: b.sleutel,
          naam: b.naam,
          materiaal: b.materiaal,
          gewichtsstap: b.gewichtsstap,
          perKant: b.perKant,
          unilateraal: b.unilateraal,
          spierenPrimair: b.spierenPrimair.length ? b.spierenPrimair : k.spierenPrimair,
          spierenSecundair: b.spierenPrimair.length ? b.spierenSecundair : k.spierenSecundair,
          knieGevoelig: b.knieGevoelig || k.knieGevoelig,
          bekend: b.heeftGeschiedenis,
          alternatievenBestaand: b.alternatieven,
          bibliotheekId: k.bibliotheekId ?? b.bibliotheekId,
        }
      : k;

  const uitCatalogus = CATALOGUS.map((c: CatalogusOefening, i): Kandidaat => {
    const k: Kandidaat = {
      sleutel: c.sleutel,
      naam: c.naam,
      bibliotheekId: c.bibliotheekId,
      patroon: c.patroon,
      materiaal: c.materiaal,
      nodig: c.nodig ?? [],
      mechaniek: c.mechaniek,
      spierenPrimair: c.spierenPrimair,
      spierenSecundair: c.spierenSecundair,
      gewichtsstap: c.gewichtsstap,
      perKant: c.perKant ?? false,
      unilateraal: c.perKant ?? false,
      knieGevoelig: c.knieGevoelig ?? false,
      schouderBelastend: c.schouderBelastend ?? false,
      rugBelastend: c.rugBelastend ?? false,
      niveau: c.niveau,
      hoofdlift: c.hoofdlift ?? false,
      cue: c.cue,
      favoriet: favoriet.has(c.bibliotheekId),
      bekend: false,
      alternatievenBestaand: [],
      volgorde: i,
    };
    return metBestaand(k, perSleutel.get(c.sleutel) ?? perNaam.get(c.naam.toLowerCase()));
  });

  const inCatalogus = new Set(CATALOGUS.map((c) => c.bibliotheekId));
  const uitBibliotheek = bibliotheekFavorieten
    .filter((b) => !inCatalogus.has(b.id) && b.patroon !== "overig" && favoriet.has(b.id))
    .map((b, i): Kandidaat => {
      const k: Kandidaat = {
        sleutel: slug(b.id),
        naam: b.naam.slice(0, 80),
        bibliotheekId: b.id,
        patroon: b.patroon,
        materiaal: b.materiaal,
        nodig: [],
        mechaniek: b.mechaniek ?? "compound",
        spierenPrimair: b.spierenPrimair,
        spierenSecundair: b.spierenSecundair,
        gewichtsstap: b.gewichtsstap,
        perKant: b.unilateraal,
        unilateraal: b.unilateraal,
        knieGevoelig: b.knieGevoelig,
        schouderBelastend: false,
        rugBelastend: false,
        niveau: b.niveau === "expert" ? 3 : b.niveau === "intermediate" ? 2 : 1,
        hoofdlift: false,
        cue: "",
        favoriet: true,
        bekend: false,
        alternatievenBestaand: [],
        volgorde: CATALOGUS.length + i,
      };
      return metBestaand(k, perBibliotheek.get(b.id) ?? perSleutel.get(k.sleutel) ?? perNaam.get(k.naam.toLowerCase()));
    });

  // Twee catalogusregels kunnen op dezelfde bestaande oefening uitkomen; houd er één.
  const gezien = new Set<string>();
  return [...uitCatalogus, ...uitBibliotheek].filter((k) => (gezien.has(k.sleutel) ? false : (gezien.add(k.sleutel), true)));
}

function toegestaan(k: Kandidaat, v: Voorkeuren): boolean {
  const materiaal = new Set(["lichaamsgewicht", ...v.materiaal]);
  if (!materiaal.has(k.materiaal)) return false;
  if (k.nodig.some((n) => !materiaal.has(n))) return false;
  if (k.bibliotheekId && v.uitgesloten.includes(k.bibliotheekId)) return false;
  if (v.blessures.includes("schouder") && k.schouderBelastend) return false;
  if (v.blessures.includes("rug") && k.rugBelastend) return false;
  if (v.ervaring === "beginner" && k.niveau >= 3) return false;
  return true;
}

function score(k: Kandidaat, v: Voorkeuren, slot: Slot, gebruikt: number): number {
  let punten = -k.volgorde;
  if (k.favoriet) punten += 1000;
  if (k.bekend) punten += 60;
  if (v.doel === "kracht" && k.hoofdlift && slot.prioriteit === 1) punten += 80;
  if (v.ervaring === "beginner" && k.niveau === 1) punten += 25;
  if (v.ervaring === "ervaren" && k.niveau === 2) punten += 10;
  // Liever niet twee keer per week dezelfde oefening, ook niet een favoriet, als er een goed alternatief is.
  punten -= gebruikt * 1500;
  return punten;
}

// ---------- Het voorstel ----------

export interface VoorstelRegel {
  sleutel: string;
  naam: string;
  bibliotheekId: string | null;
  patroon: Patroon;
  prioriteit: Prioriteit;
  sets: number;
  repMin: number;
  repMax: number;
  rir: number;
  rust: number;
  perKant: boolean;
  knieGevoelig: boolean;
  spierenPrimair: string[];
  spierenSecundair: string[];
  cue: string;
  alternatieven: string[];
}

export interface VoorstelSessie {
  code: string;
  naam: string;
  minuten: number;
  regels: VoorstelRegel[];
}

export interface Voorstel {
  split: { naam: string; uitleg: string };
  sessies: VoorstelSessie[];
  volume: { spier: string; label: string; sets: number; doel: number | null }[];
  opmerkingen: string[];
  bestand: Record<string, unknown>;
}

const PATROON_TEKST: Record<Patroon, string> = {
  knie_dominant: "squat of lunge",
  heup_dominant: "heupscharnier (zoals een deadlift)",
  horizontaal_duwen: "duwen (zoals bankdrukken)",
  verticaal_duwen: "boven je hoofd duwen",
  horizontaal_trekken: "roeien",
  verticaal_trekken: "naar beneden trekken (zoals een lat pulldown)",
  quad_isolatie: "voorkant bovenbeen apart",
  hamstring_curl: "leg curl",
  borst_isolatie: "borst apart",
  zijkant_schouder: "zijkant schouders",
  achterkant_schouder: "achterkant schouders",
  biceps: "biceps",
  triceps: "triceps",
  kuiten: "kuiten",
  buik: "buik",
  overig: "overig",
};

const label = (spier: string) => ALLE_SPIER_LABELS[spier] ?? spier;

function sessieVolume(regels: VoorstelRegel[]): Record<string, number> {
  return fractioneleSets(regels.map((r) => ({ spierenPrimair: r.spierenPrimair, spierenSecundair: r.spierenSecundair, sets: r.sets })));
}

function weekVolume(sessies: VoorstelSessie[]): Record<string, number> {
  return fractioneleSets(sessies.flatMap((s) => s.regels.map((r) => ({ spierenPrimair: r.spierenPrimair, spierenSecundair: r.spierenSecundair, sets: r.sets }))));
}

const minutenSessie = (regels: VoorstelRegel[]) => minutenVoor(regels.map((r) => ({ sets: r.sets, rust: r.rust, perKant: r.perKant })));

const MIN_SETS = 2;
const MAX_SETS = 4;
/** Bij een gevoelige knie: hoogstens zoveel sets per kniebelastende oefening. */
const KNIE_MAX_SETS = 3;

export function maakVoorstel(invoer: GeneratorInvoer): Voorstel {
  const v = invoer.voorkeuren;
  const split = kiesSplit(v.dagenPerWeek);
  const alle = kandidaten(invoer);
  const mogelijk = alle.filter((k) => toegestaan(k, v));
  const opmerkingen: string[] = [];
  const knieMax = v.blessures.includes("knie") ? 1 : 3;
  const gebruikt = new Map<string, number>();
  const ontbrekend = new Set<Patroon>();

  // 1. Oefeningen kiezen. Per training eerst de belangrijkste patronen, zodat die de kniebudgetten krijgen.
  const sessies: VoorstelSessie[] = split.sessies.map((sjabloon) => {
    const regels: VoorstelRegel[] = [];
    let knie = 0;
    const slots = [...sjabloon.slots]
      .map((slot) => ({
        ...slot,
        prioriteit: (v.focus.length && FOCUS_PATRONEN[slot.patroon]?.some((m) => v.focus.includes(m)) ? 1 : slot.prioriteit) as Prioriteit,
      }))
      .sort((a, b) => a.prioriteit - b.prioriteit);
    for (const slot of slots) {
      const opties = mogelijk
        .filter((k) => k.patroon === slot.patroon && !regels.some((r) => r.sleutel === k.sleutel))
        .filter((k) => !k.knieGevoelig || knie < knieMax)
        .sort((a, b) => score(b, v, slot, gebruikt.get(b.sleutel) ?? 0) - score(a, v, slot, gebruikt.get(a.sleutel) ?? 0));
      const k = opties[0];
      if (!k) {
        if (!mogelijk.some((m) => m.patroon === slot.patroon)) ontbrekend.add(slot.patroon);
        continue;
      }
      if (k.knieGevoelig) knie++;
      gebruikt.set(k.sleutel, (gebruikt.get(k.sleutel) ?? 0) + 1);
      const u = uitvoering(v, { mechaniek: k.mechaniek, patroon: k.patroon, hoofdlift: k.hoofdlift, knieGevoelig: k.knieGevoelig }, slot.prioriteit);
      const alternatieven = mogelijk
        .filter((a) => a.patroon === k.patroon && a.sleutel !== k.sleutel)
        .sort((a, b) => score(b, v, slot, 0) - score(a, v, slot, 0))
        .slice(0, 2)
        .map((a) => a.sleutel);
      regels.push({
        sleutel: k.sleutel,
        naam: k.naam,
        bibliotheekId: k.bibliotheekId,
        patroon: k.patroon,
        prioriteit: slot.prioriteit,
        sets: slot.prioriteit === 3 && k.mechaniek !== "compound" ? MIN_SETS : 3,
        repMin: u.repMin,
        repMax: u.repMax,
        rir: u.rir,
        rust: u.rust,
        perKant: k.perKant,
        knieGevoelig: k.knieGevoelig,
        spierenPrimair: k.spierenPrimair,
        spierenSecundair: k.spierenSecundair,
        cue: k.cue,
        alternatieven: [...new Set([...k.alternatievenBestaand, ...alternatieven])].filter((a) => a !== k.sleutel),
      });
    }
    // Volgorde in de training: grote oefeningen eerst, dan de rest op prioriteit.
    const plek = (r: VoorstelRegel) => [r.prioriteit === 1 ? 0 : 1, COMPOUND_PATRONEN.includes(r.patroon) ? 0 : 1, r.prioriteit];
    regels.sort((a, b) => {
      const [pa, pb] = [plek(a), plek(b)];
      return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
    });
    return { code: sjabloon.code, naam: sjabloon.naam, minuten: 0, regels };
  });

  for (const patroon of ontbrekend) {
    opmerkingen.push(`Geen oefening voor ${PATROON_TEKST[patroon]} met jouw materiaal of blessures; die plek blijft leeg.`);
  }

  // 2. Inkorten tot het in je tijd past. Eerst de rust naar de ondergrens uit onderzoek, dan de
  //    kleinste oefeningen eruit, en pas als laatste minder sets op de grote oefeningen.
  const budget = v.minutenPerTraining;
  const doelen = weekdoelen(v);
  let rustVerkort = false;
  for (const sessie of sessies) {
    let veiligheid = 200;
    while (minutenSessie(sessie.regels) > budget && veiligheid-- > 0) {
      const lang = sessie.regels.filter((r) => r.rust > minimaleRust(v.doel, r));
      if (lang.length) {
        for (const r of lang) r.rust = minimaleRust(v.doel, r);
        rustVerkort = true;
        continue;
      }
      const week = weekVolume(sessies);
      const overschot = (r: VoorstelRegel) => Math.max(...r.spierenPrimair.map((m) => (week[m] ?? 0) - (doelen[m] ?? 0)));
      const meestOver = (lijst: VoorstelRegel[]) => [...lijst].sort((a, b) => overschot(b) - overschot(a))[0];
      let gedaan = false;
      for (const prioriteit of [3, 2, 1] as Prioriteit[]) {
        const groep = sessie.regels.filter((r) => r.prioriteit === prioriteit);
        const verlaagbaar = groep.filter((r) => r.sets > MIN_SETS);
        if (verlaagbaar.length) {
          meestOver(verlaagbaar).sets--;
          gedaan = true;
          break;
        }
        if (prioriteit > 1 && groep.length) {
          sessie.regels.splice(sessie.regels.indexOf(meestOver(groep)), 1);
          gedaan = true;
          break;
        }
      }
      if (!gedaan) break;
    }
    if (minutenSessie(sessie.regels) > budget) {
      opmerkingen.push(`${sessie.naam} duurt ook met 2 sets per oefening ongeveer ${minutenSessie(sessie.regels)} minuten, iets langer dan je ${budget} minuten.`);
    }
  }

  // 3. Aanvullen waar een spiergroep onder het weekdoel blijft, binnen je tijd en de grens per training.
  const vol = new Set<string>();
  for (let ronde = 0; ronde < 300; ronde++) {
    const week = weekVolume(sessies);
    const tekort = Object.entries(doelen)
      .filter(([m, doel]) => !vol.has(m) && (week[m] ?? 0) < doel)
      .sort(([a, da], [b, db]) => ((week[a] ?? 0) / da) - ((week[b] ?? 0) / db));
    if (!tekort.length) break;
    const [spier] = tekort[0];
    const opties = sessies
      .flatMap((sessie) => sessie.regels.map((r) => ({ sessie, r })))
      .filter(({ r }) => r.spierenPrimair.includes(spier) && r.sets < (knieMaxSets(r) ?? MAX_SETS))
      .filter(({ sessie, r }) => {
        r.sets++;
        const past = minutenSessie(sessie.regels) <= budget && Object.values(sessieVolume(sessie.regels)).every((x) => x <= SETS_PER_TRAINING_GRENS);
        r.sets--;
        return past;
      })
      .sort((a, b) => a.r.sets - b.r.sets || a.r.prioriteit - b.r.prioriteit);
    if (!opties.length) {
      vol.add(spier);
      continue;
    }
    opties[0].r.sets++;
  }

  for (const sessie of sessies) sessie.minuten = minutenSessie(sessie.regels);

  function knieMaxSets(r: VoorstelRegel): number | null {
    return v.blessures.includes("knie") && r.knieGevoelig ? KNIE_MAX_SETS : null;
  }

  // 4. Toelichting.
  const week = weekVolume(sessies);
  const volume = [...new Set([...Object.keys(doelen), ...Object.keys(week)])]
    .filter((m) => (week[m] ?? 0) > 0 || doelen[m])
    .map((m) => ({ spier: m, label: label(m), sets: week[m] ?? 0, doel: doelen[m] ?? null }))
    .sort((a, b) => (b.doel ?? -1) - (a.doel ?? -1) || b.sets - a.sets);
  const achter = volume.filter((r) => r.doel !== null && r.sets < r.doel * 0.8);
  if (achter.length) {
    opmerkingen.push(
      `Onder je weekdoel: ${achter.map((r) => `${r.label.toLowerCase()} (${fmt(r.sets)} van ${r.doel})`).join(", ")}. ` +
        (v.dagenPerWeek < 4 || v.minutenPerTraining < 60 ? "Meer tijd per training of een extra dag lost dat op." : "Dat komt door je materiaal of blessures."),
    );
  }
  if (rustVerkort) {
    opmerkingen.push("Om in je tijd te passen is de rust korter gezet: 90 seconden bij grote oefeningen, 60 bij kleine. Langer rusten gaf in onderzoek geen meetbaar extra effect op spiergroei.");
  }
  if (v.blessures.includes("knie")) {
    opmerkingen.push("Knie: hoogstens één kniebelastende oefening per training, met meer reps en meer over. De kniepijnregel blijft gelden.");
  }
  if (v.blessures.includes("schouder")) opmerkingen.push("Schouder: geen stang boven je hoofd en geen dips; dumbbells en machines in een pijnvrij bereik.");
  if (v.blessures.includes("rug")) opmerkingen.push("Onderrug: geen zware stang op of voor je rug; machines en ondersteunde varianten.");

  return { split: { naam: split.naam, uitleg: split.uitleg }, sessies, volume, opmerkingen, bestand: naarBestand(invoer, split, sessies, alle) };
}

/** Patronen die een focusspier als hoofdspier trainen. */
const FOCUS_PATRONEN: Partial<Record<Patroon, string[]>> = {
  knie_dominant: ["quads", "glutes"],
  heup_dominant: ["hamstrings", "glutes"],
  horizontaal_duwen: ["chest"],
  verticaal_duwen: ["front_delts"],
  horizontaal_trekken: ["upper_back", "lats"],
  verticaal_trekken: ["lats"],
  quad_isolatie: ["quads"],
  hamstring_curl: ["hamstrings"],
  borst_isolatie: ["chest"],
  zijkant_schouder: ["side_delts"],
  achterkant_schouder: ["rear_delts"],
  biceps: ["biceps"],
  triceps: ["triceps"],
  kuiten: ["calves"],
  buik: ["abs"],
};

/** Grote, samengestelde bewegingen: die komen in een training eerst. */
const COMPOUND_PATRONEN: Patroon[] = ["knie_dominant", "heup_dominant", "horizontaal_duwen", "verticaal_duwen", "horizontaal_trekken", "verticaal_trekken"];

const fmt = (n: number) => String(Math.round(n * 10) / 10).replace(".", ",");

const NAAR_JSON_MATERIAAL: Record<string, string> = {
  dumbbell: "dumbbell",
  barbell: "barbell",
  trap_bar: "trap_bar",
  kabel: "cable",
  machine: "machine",
  lichaamsgewicht: "bodyweight",
  kettlebell: "kettlebell",
  band: "band",
  overig: "other",
};

function naarBestand(invoer: GeneratorInvoer, split: Split, sessies: VoorstelSessie[], alle: Kandidaat[]): Record<string, unknown> {
  const v = invoer.voorkeuren;
  const perSleutel = new Map(alle.map((k) => [k.sleutel, k]));
  const bestaand = new Map(invoer.bestaand.map((b) => [b.sleutel, b]));

  // Elke oefening in het bestand, plus (recursief) haar alternatieven: de import eist dat die erin staan.
  const inBestand = new Map<string, Record<string, unknown>>();
  const gekozen = new Map(sessies.flatMap((s) => s.regels.map((r) => [r.sleutel, r] as const)));
  const wachtrij = [...gekozen.keys()];
  while (wachtrij.length) {
    const sleutel = wachtrij.shift()!;
    if (inBestand.has(sleutel)) continue;
    const k = perSleutel.get(sleutel);
    const b = bestaand.get(sleutel);
    if (!k && !b) continue;
    const regel = gekozen.get(sleutel);
    const alternatieven = regel ? regel.alternatieven : (b?.alternatieven ?? []);
    const eigenSpieren = b && b.spierenPrimair.length > 0;
    const oefening = {
      id: sleutel,
      name: b?.naam ?? k?.naam ?? sleutel,
      library_id: k?.bibliotheekId ?? b?.bibliotheekId ?? undefined,
      muscles_primary: eigenSpieren ? b.spierenPrimair : (k?.spierenPrimair ?? []),
      muscles_secondary: eigenSpieren ? b.spierenSecundair : (k?.spierenSecundair ?? []),
      equipment: NAAR_JSON_MATERIAAL[b?.materiaal ?? k?.materiaal ?? "overig"] ?? "other",
      mechanic: (b?.mechaniek ?? k?.mechaniek) || undefined,
      unilateral: b?.unilateraal ?? k?.unilateraal ?? false,
      knee_sensitive: b?.knieGevoelig ?? k?.knieGevoelig ?? false,
      increment_kg: b?.gewichtsstap ?? k?.gewichtsstap ?? 0,
      alternatives: alternatieven,
    };
    inBestand.set(sleutel, oefening);
    wachtrij.push(...alternatieven);
  }
  // Alternatieven die nergens te vinden zijn (zou niet moeten), weglaten.
  for (const o of inBestand.values()) {
    o.alternatives = (o.alternatives as string[]).filter((a) => inBestand.has(a));
  }

  const doel = invoer.doelLichaam;
  return {
    schema_version: 1,
    program: {
      id: "op_maat",
      name: `Op maat: ${split.naam}`.slice(0, 60),
      created: invoer.dag,
      sessions_per_week: [v.dagenPerWeek, v.dagenPerWeek],
      schedule_mode: "rotation",
      rotation: sessies.map((s) => s.code),
      min_rest_days_between_sessions: v.dagenPerWeek <= 3 ? 1 : 0,
      warmup: "5–10 min fietsen of roeien + 1–2 lichte opwarmsets van de eerste oefening.",
      ...(doel && doel.doelKg !== null
        ? { goal: { bodyweight_start_kg: doel.startKg ?? undefined, bodyweight_target_kg: doel.doelKg, rate_kg_per_week: doel.tempo ?? undefined } }
        : {}),
    },
    rules: {
      intro_phase: { weeks: 2, sets_override: 2, target_rir: 3 },
      progression: { type: "double_progression" },
      deload: { every_n_weeks: 8, sets_multiplier: 0.5, load_multiplier: 1 },
    },
    muscle_labels_nl: SPIER_LABELS,
    workouts: sessies.map((s) => ({
      id: s.code,
      name: s.naam,
      focus: [...new Set(s.regels.filter((r) => r.prioriteit === 1).flatMap((r) => r.spierenPrimair))],
      estimated_minutes: s.minuten,
      exercises: s.regels.map((r, i) => ({
        order: i + 1,
        exercise_id: r.sleutel,
        sets: r.sets,
        rep_min: r.repMin,
        rep_max: r.repMax,
        per_side: r.perKant,
        rest_seconds: r.rust,
        target_rir: r.rir,
        cue: r.cue,
      })),
    })),
    exercises: [...inBestand.values()],
  };
}
