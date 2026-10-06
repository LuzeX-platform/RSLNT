// De oefeningenbibliotheek: data/bibliotheek.json (876 oefeningen uit Free Exercise DB) in het
// geheugen, met zoeken en filteren. Zoeken werkt ook met Nederlandse woorden ("bankdrukken",
// "kuit", "roeien") en met de Nederlandse namen van spiergroepen.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AFBEELDING_BASIS, type BibliotheekOefening, type Patroon } from "./bibliotheekOmzetten.js";
import { CATALOGUS, type CatalogusOefening } from "./catalogus.js";
import { ALLE_SPIER_LABELS as SPIER_LABELS } from "./spieren.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Werkt vanuit src/ (tsx) en dist/ (productie): beide liggen één niveau onder backend/.
const BESTAND = path.join(__dirname, "..", "data", "bibliotheek.json");

export interface BibliotheekBestand {
  bron: string;
  url: string;
  commit: string;
  licentie: string;
  oefeningen: BibliotheekOefening[];
}

let geladen: { bestand: BibliotheekBestand; perId: Map<string, BibliotheekOefening> } | null = null;

export function bibliotheek() {
  if (!geladen) {
    const bestand = JSON.parse(readFileSync(BESTAND, "utf8")) as BibliotheekBestand;
    geladen = { bestand, perId: new Map(bestand.oefeningen.map((o) => [o.id, o])) };
  }
  return geladen;
}

export const MATERIAAL_LABELS: Record<string, string> = {
  dumbbell: "Dumbbell",
  barbell: "Stang",
  trap_bar: "Trap bar",
  kabel: "Kabel",
  machine: "Machine",
  lichaamsgewicht: "Lichaamsgewicht",
  kettlebell: "Kettlebell",
  band: "Band",
  overig: "Overig",
};

export const PATROON_LABELS: Record<Patroon, string> = {
  knie_dominant: "Squat en lunge",
  heup_dominant: "Heupscharnier",
  horizontaal_duwen: "Duwen (borst)",
  verticaal_duwen: "Duwen (boven je hoofd)",
  horizontaal_trekken: "Roeien",
  verticaal_trekken: "Naar beneden trekken",
  quad_isolatie: "Voorkant bovenbeen apart",
  hamstring_curl: "Leg curl",
  borst_isolatie: "Borst apart",
  zijkant_schouder: "Zijkant schouders",
  achterkant_schouder: "Achterkant schouders",
  biceps: "Biceps",
  triceps: "Triceps",
  kuiten: "Kuiten",
  buik: "Buik",
  overig: "Overig",
};

export const CATEGORIE_LABELS: Record<string, string> = {
  strength: "Kracht",
  powerlifting: "Powerlifting",
  "olympic weightlifting": "Olympisch gewichtheffen",
  strongman: "Strongman",
  plyometrics: "Sprongkracht",
  stretching: "Rekken",
  cardio: "Cardio",
};

export const NIVEAU_LABELS: Record<string, string> = { beginner: "Beginner", intermediate: "Gevorderd", expert: "Ervaren" };

/** Nederlandse zoekwoorden → Engelse woorden in de oefeningnamen. */
const SYNONIEMEN: Record<string, string[]> = {
  bankdrukken: ["bench press"],
  bank: ["bench"],
  borstpers: ["chest press"],
  schouderpers: ["shoulder press", "military press", "overhead press"],
  drukken: ["press"],
  opdrukken: ["push-up", "pushup"],
  opdrukoefening: ["push-up", "pushup"],
  optrekken: ["pull-up", "pullup", "chin"],
  roeien: ["row"],
  kniebuiging: ["squat"],
  hurken: ["squat"],
  uitvalspas: ["lunge"],
  uitval: ["lunge"],
  opstap: ["step up", "step-up"],
  heffen: ["deadlift"],
  kuit: ["calf", "calves"],
  kuiten: ["calf", "calves"],
  buik: ["crunch", "ab ", "abdominal"],
  buikspieren: ["crunch", "ab ", "abdominal"],
  zijwaarts: ["lateral", "side"],
  vlinder: ["fly", "flye", "butterfly"],
  kabel: ["cable"],
  stang: ["barbell"],
  halter: ["dumbbell"],
  dumbell: ["dumbbell"],
  machine: ["machine", "leverage"],
  elastiek: ["band"],
  heup: ["hip"],
  billen: ["glute", "hip thrust"],
  rug: ["back", "row"],
  schouder: ["shoulder", "delt"],
  schouders: ["shoulder", "delt"],
};

const normaal = (tekst: string) =>
  tekst.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[_]/g, " ");

const catalogusPerBibliotheek = new Map<string, CatalogusOefening>();
for (const c of CATALOGUS) if (!catalogusPerBibliotheek.has(c.bibliotheekId)) catalogusPerBibliotheek.set(c.bibliotheekId, c);

export function inCatalogus(id: string): CatalogusOefening | undefined {
  return catalogusPerBibliotheek.get(id);
}

function zoektekst(o: BibliotheekOefening): string {
  const c = catalogusPerBibliotheek.get(o.id);
  return normaal(
    [
      o.naam,
      c?.naam ?? "",
      ...[...o.spierenPrimair, ...o.spierenSecundair].map((s) => SPIER_LABELS[s] ?? s),
      MATERIAAL_LABELS[o.materiaal] ?? "",
      PATROON_LABELS[o.patroon] ?? "",
    ].join(" "),
  );
}

export interface ZoekFilters {
  zoek?: string;
  spier?: string;
  materiaal?: string;
  patroon?: string;
  /** Alleen oefeningen die niet als knie-gevoelig gelden. */
  knievriendelijk?: boolean;
  /** Alleen deze id's (bijvoorbeeld je favorieten). */
  ids?: Set<string>;
}

export function zoekOefeningen(lijst: BibliotheekOefening[], f: ZoekFilters): BibliotheekOefening[] {
  const woorden = normaal(f.zoek ?? "").split(/\s+/).filter(Boolean);
  const resultaat = lijst.filter((o) => {
    if (f.ids && !f.ids.has(o.id)) return false;
    if (f.spier && !o.spierenPrimair.includes(f.spier) && !o.spierenSecundair.includes(f.spier)) return false;
    if (f.materiaal && o.materiaal !== f.materiaal) return false;
    if (f.patroon && o.patroon !== f.patroon) return false;
    if (f.knievriendelijk && (o.knieGevoelig || catalogusPerBibliotheek.get(o.id)?.knieGevoelig)) return false;
    if (!woorden.length) return true;
    const tekst = zoektekst(o);
    return woorden.every((w) => [w, ...(SYNONIEMEN[w] ?? [])].some((alt) => tekst.includes(alt)));
  });
  // Bekende oefeningen (de basislijst) eerst, dan oefeningen waarvan de naam met je zoekwoord begint,
  // dan oefeningen met je spier als hoofdspier, dan op naam.
  const eerste = woorden[0];
  const begint = (o: BibliotheekOefening) =>
    eerste ? [eerste, ...(SYNONIEMEN[eerste] ?? [])].some((alt) => normaal(o.naam).startsWith(alt)) : false;
  return resultaat.sort(
    (a, b) =>
      Number(catalogusPerBibliotheek.has(b.id)) - Number(catalogusPerBibliotheek.has(a.id)) ||
      Number(begint(b)) - Number(begint(a)) ||
      Number(f.spier ? b.spierenPrimair.includes(f.spier) : 0) - Number(f.spier ? a.spierenPrimair.includes(f.spier) : 0) ||
      a.naam.localeCompare(b.naam, "en"),
  );
}

/** Wat de lijst nodig heeft: klein houden, het zijn er soms honderden. */
export function kort(o: BibliotheekOefening) {
  const c = catalogusPerBibliotheek.get(o.id);
  return {
    id: o.id,
    naam: c?.naam ?? o.naam,
    bronNaam: o.naam,
    materiaal: o.materiaal,
    spierenPrimair: o.spierenPrimair,
    patroon: o.patroon,
    knieGevoelig: o.knieGevoelig || Boolean(c?.knieGevoelig),
    niveau: o.niveau,
    categorie: o.categorie,
    basislijst: Boolean(c),
    afbeelding: o.afbeeldingen[0] ? AFBEELDING_BASIS + o.afbeeldingen[0] : null,
  };
}

/** Vergelijkbare oefeningen: zelfde bewegingspatroon en hoofdspier, bekende eerst. */
export function vergelijkbaar(o: BibliotheekOefening, lijst: BibliotheekOefening[], aantal = 8): BibliotheekOefening[] {
  if (o.patroon === "overig") {
    return lijst
      .filter((x) => x.id !== o.id && x.spierenPrimair[0] === o.spierenPrimair[0] && x.categorie === o.categorie)
      .slice(0, aantal);
  }
  return lijst
    .filter((x) => x.id !== o.id && x.patroon === o.patroon)
    .sort(
      (a, b) =>
        Number(catalogusPerBibliotheek.has(b.id)) - Number(catalogusPerBibliotheek.has(a.id)) ||
        Number(b.spierenPrimair[0] === o.spierenPrimair[0]) - Number(a.spierenPrimair[0] === o.spierenPrimair[0]) ||
        Number(b.materiaal === o.materiaal) - Number(a.materiaal === o.materiaal) ||
        a.naam.localeCompare(b.naam, "en"),
    )
    .slice(0, aantal);
}
