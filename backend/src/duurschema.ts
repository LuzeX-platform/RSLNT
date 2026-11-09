// Pure logica: een duursportschema (hardlopen, fietsen, zwemmen) naast je krachttraining. Voor
// iedereen, met een doel naar keuze: conditie, een afstand halen of afvallen. De regels en hun
// onderbouwing staan op de Wetenschap-pagina (#duurschema):
// - Verdeling: zo'n 80% rustig (je kunt praten), hoogstens 20% hard (Seiler 2010; Stöggl &
//   Sperlich 2014). Beginners de eerste weken alleen rustig.
// - Opbouw: hoogstens ~10% meer per week, met elke 4e week een rustigere week. De 10% is een
//   praktijkregel: onderzoek vond wel dat flinke sprongen (>30%) bij beginnende lopers samengaan
//   met meer blessures (Nielsen 2014), niet dat 10% precies de grens is (Buist 2008).
// - Afstandsdoel: de laatste week minder volume, zelfde intensiteit (taper; Bosquet 2007).
// - Hardlopen vanaf nul: wandelen en hardlopen afwisselen tot 30 minuten aan één stuk (praktijk).
// - Afvallen: vooral rustige minuten erbij (WHO: 150–300 min per week); het meeste doet je eten.

export const DUUR_SPORTEN = { hardlopen: "Hardlopen", fietsen: "Fietsen", zwemmen: "Zwemmen" } as const;
export type DuurSport = keyof typeof DUUR_SPORTEN;
export const DUUR_DOELEN = { conditie: "Betere conditie", afstand: "Een afstand halen", afvallen: "Afvallen ondersteunen" } as const;
export type DuurDoel = keyof typeof DUUR_DOELEN;
export const DUUR_NIVEAUS = {
  beginner: "Beginner",
  gevorderd: "Ik doe het al",
} as const;
export type DuurNiveau = keyof typeof DUUR_NIVEAUS;

/** Wat "beginner" en "ik doe het al" per sport betekent, voor in de app. */
export const NIVEAU_UITLEG: Record<DuurSport, Record<DuurNiveau, string>> = {
  hardlopen: { beginner: "Je kunt nog geen 30 minuten achter elkaar hardlopen.", gevorderd: "Je loopt 30 minuten rustig zonder te stoppen." },
  fietsen: { beginner: "Een uur fietsen is nog pittig.", gevorderd: "Je fietst makkelijk een uur of langer." },
  zwemmen: { beginner: "Een paar baantjes achter elkaar is nog lastig.", gevorderd: "Je zwemt 500 meter zonder stoppen." },
};

/** De afstanden die je als doel kunt kiezen: km bij hardlopen en fietsen, meters bij zwemmen. */
export const AFSTANDEN: Record<DuurSport, { waarde: number; label: string; weken: Record<DuurNiveau, number | null> }[]> = {
  hardlopen: [
    { waarde: 5, label: "5 km", weken: { beginner: 10, gevorderd: 8 } },
    { waarde: 10, label: "10 km", weken: { beginner: 14, gevorderd: 10 } },
    { waarde: 21.1, label: "Halve marathon", weken: { beginner: null, gevorderd: 14 } },
  ],
  fietsen: [
    { waarde: 50, label: "50 km", weken: { beginner: 8, gevorderd: 6 } },
    { waarde: 100, label: "100 km", weken: { beginner: 12, gevorderd: 10 } },
  ],
  zwemmen: [
    { waarde: 500, label: "500 meter", weken: { beginner: 8, gevorderd: 6 } },
    { waarde: 1000, label: "1000 meter", weken: { beginner: 10, gevorderd: 8 } },
    { waarde: 1500, label: "1500 meter", weken: { beginner: 12, gevorderd: 10 } },
  ],
};

export interface DuurInstellingen {
  sport: DuurSport;
  doel: DuurDoel;
  /** Alleen bij doel "afstand": een waarde uit AFSTANDEN. */
  afstand: number | null;
  niveau: DuurNiveau;
  dagenPerWeek: number;
}

export type DuurIntensiteit = "rustig" | "duur" | "tempo" | "interval";
export type DuurRol = "rustig" | "lang" | "kwaliteit" | "doel";

export interface DuurSessieVoorstel {
  sport: DuurSport;
  rol: DuurRol;
  titel: string;
  intensiteit: DuurIntensiteit;
  minuten: number;
  /** Zwemmen: meters. */
  meters: number | null;
  uitleg: string;
}

export interface DuurWeek {
  week: number;
  thema: string;
  sessies: DuurSessieVoorstel[];
}

export interface Duurschema {
  titel: string;
  uitleg: string;
  weken: DuurWeek[];
  /** true: na de laatste week blijft de laatste week gelden (onderhoud). false: het schema eindigt met je doel. */
  doorlopend: boolean;
  opmerkingen: string[];
}

export class DuurFout extends Error {}

const DOORLOPEND_WEKEN = 12;
const HERSTEL_ELKE = 4;
const GROEI = 1.1;

/** Weekvolume: minuten (hardlopen, fietsen) of meters (zwemmen). [start, piek] per niveau. */
const VOLUME: Record<DuurSport, Record<string, Record<DuurNiveau, [number, number] | null>>> = {
  hardlopen: {
    conditie: { beginner: [75, 120], gevorderd: [100, 180] },
    afvallen: { beginner: [75, 150], gevorderd: [110, 210] },
    "5": { beginner: [75, 120], gevorderd: [100, 150] },
    "10": { beginner: [75, 160], gevorderd: [120, 200] },
    "21.1": { beginner: null, gevorderd: [150, 270] },
  },
  fietsen: {
    conditie: { beginner: [90, 180], gevorderd: [150, 240] },
    afvallen: { beginner: [100, 210], gevorderd: [160, 300] },
    "50": { beginner: [100, 210], gevorderd: [150, 240] },
    "100": { beginner: [120, 300], gevorderd: [180, 360] },
  },
  zwemmen: {
    conditie: { beginner: [1000, 2800], gevorderd: [2500, 5000] },
    afvallen: { beginner: [1200, 3200], gevorderd: [3000, 6000] },
    "500": { beginner: [1000, 2400], gevorderd: [2000, 3500] },
    "1000": { beginner: [1000, 3200], gevorderd: [2500, 5000] },
    "1500": { beginner: [1200, 4200], gevorderd: [3000, 6500] },
  },
};

/** Langste sessie hoogstens zoveel minuten (hardlopen, fietsen): genoeg voor het doel, niet meer. */
const LANG_MAX: Record<DuurSport, Record<string, number>> = {
  hardlopen: { conditie: 60, afvallen: 70, "5": 45, "10": 75, "21.1": 120 },
  fietsen: { conditie: 120, afvallen: 150, "50": 150, "100": 270 },
  zwemmen: {},
};

/** Hardlopen vanaf nul: [minuten hardlopen, minuten wandelen, herhalingen] per week. */
const LOOP_WANDEL: [number, number, number][] = [
  [1, 2, 8],
  [2, 2, 6],
  [3, 2, 5],
  [4, 1.5, 4],
  [5, 1, 4],
  [8, 1, 3],
  [10, 1, 3],
  [15, 1, 2],
];

/** Zwemtempo per 100 m in minuten, inclusief korte rustpauzes. */
const ZWEM_TEMPO: Record<DuurNiveau, number> = { beginner: 3.2, gevorderd: 2.3 };

const rond5 = (x: number) => Math.max(5, Math.round(x / 5) * 5);
const rond50 = (x: number) => Math.max(100, Math.round(x / 50) * 50);
const getal = (x: number) => String(x).replace(".", ",");

export function controleer(i: DuurInstellingen): void {
  if (!(i.sport in DUUR_SPORTEN)) throw new DuurFout("Kies hardlopen, fietsen of zwemmen.");
  if (!(i.doel in DUUR_DOELEN)) throw new DuurFout("Kies een doel.");
  if (i.dagenPerWeek < 2 || i.dagenPerWeek > 4) throw new DuurFout("Kies 2, 3 of 4 keer per week.");
  if (i.doel === "afstand") {
    const a = AFSTANDEN[i.sport].find((x) => x.waarde === i.afstand);
    if (!a) throw new DuurFout("Kies een afstand.");
    if (a.weken[i.niveau] === null) throw new DuurFout(`${a.label} is te ver om vanaf nul in één schema op te bouwen. Begin met ${AFSTANDEN[i.sport][0].label}; daarna kan dit.`);
  }
}

function sleutelVan(i: DuurInstellingen) {
  return i.doel === "afstand" ? String(i.afstand) : i.doel;
}

/** Weekvolumes: opbouw met hoogstens 10% per week, elke 4e week rustiger, bij een afstand een rustige laatste week. */
export function weekVolumes(i: DuurInstellingen): number[] {
  const [start, piek] = VOLUME[i.sport][sleutelVan(i)][i.niveau]!;
  const aantal = i.doel === "afstand" ? AFSTANDEN[i.sport].find((x) => x.waarde === i.afstand)!.weken[i.niveau]! : DOORLOPEND_WEKEN;
  const volumes: number[] = [];
  let opbouw = start;
  for (let w = 1; w <= aantal; w++) {
    const laatste = w === aantal && i.doel === "afstand";
    if (laatste) volumes.push(Math.max(start, piek * 0.6));
    else if (w % HERSTEL_ELKE === 0) volumes.push(opbouw * 0.75);
    else {
      volumes.push(opbouw);
      opbouw = Math.min(piek, opbouw * GROEI);
    }
  }
  return volumes;
}

// ---------- De sessies zelf ----------

function intervalTekst(sport: DuurSport, week: number, gevorderd: boolean): { titel: string; uitleg: string; hard: number; totaal: number } {
  // Om en om intervallen (o.a. 4×4 min, Helgerud 2007) en een tempoblok.
  const tempo = week % 2 === 0;
  if (sport === "zwemmen") {
    return tempo
      ? { titel: "Tempo", uitleg: `${gevorderd ? "4× 200" : "4× 100"} m stevig, 30 s rust ertussen`, hard: 0, totaal: 0 }
      : { titel: "Intervallen", uitleg: `${gevorderd ? "10× 50" : "8× 25"} m snel, 30 s rust ertussen`, hard: 0, totaal: 0 };
  }
  const werkwoord = sport === "hardlopen" ? "dribbelen" : "rustig trappen";
  if (tempo) {
    const blok = gevorderd ? 20 : 12;
    return { titel: "Tempo", uitleg: `${blok} min stevig (korte zinnen gaan nog net), met 10 min rustig ervoor en erna`, hard: blok, totaal: blok + 20 };
  }
  const [aantal, werk, rust] = gevorderd ? [4, 4, 3] : [5, 2, 2];
  return {
    titel: "Intervallen",
    uitleg: `${aantal}× ${werk} min hard, ${rust} min ${werkwoord} ertussen, met 10 min rustig ervoor en erna`,
    hard: aantal * werk,
    totaal: aantal * (werk + rust) + 20,
  };
}

/**
 * @param doelStuk bij een afstandsdoel: het langste stuk aan één stuk deze week, zodat je naar je
 *   doel toe groeit in plaats van van blokjes van 200 m ineens naar 1000 m te springen
 */
function zwemSessie(meters: number, rol: DuurRol, niveau: DuurNiveau, week: number, doelStuk: number | null = null): DuurSessieVoorstel {
  const m = rond50(meters);
  const tempo = ZWEM_TEMPO[niveau];
  const vroeg = niveau === "beginner" && week <= 4;
  let titel = "Rustig zwemmen";
  let uitleg: string;
  let intensiteit: DuurIntensiteit = "rustig";
  if (rol === "doel") {
    titel = "Je doel";
    uitleg = `${m} meter aan één stuk, in je eigen tempo`;
  } else if (rol === "kwaliteit") {
    const it = intervalTekst("zwemmen", week, niveau === "gevorderd");
    titel = it.titel;
    intensiteit = it.titel === "Tempo" ? "tempo" : "interval";
    uitleg = `${it.uitleg}; de rest rustig, ${m} m in totaal`;
  } else if (vroeg) {
    const stuk = week <= 2 ? 25 : 50;
    uitleg = `${Math.round(m / stuk)}× ${stuk} m rustig, 30 s rust ertussen`;
  } else if (rol === "lang" && doelStuk) {
    titel = "Langere zwemtraining";
    const stuk = Math.min(m, rond50(doelStuk));
    const rest = m - stuk;
    uitleg = rest >= 100 ? `${stuk} m rustig aan één stuk, daarna ${Math.round(rest / 100)}× 100 m rustig met 20 s rust` : `${stuk} m rustig aan één stuk`;
  } else if (rol === "lang") {
    titel = "Langere zwemtraining";
    const stuk = m >= 1200 ? 400 : m >= 600 ? 200 : 100;
    uitleg = `${Math.max(1, Math.round(m / stuk))}× ${stuk} m rustig, 20 s rust ertussen`;
  } else {
    uitleg = `${Math.max(1, Math.round(m / 100))}× 100 m rustig, 20 s rust ertussen`;
  }
  return { sport: "zwemmen", rol, titel, intensiteit, minuten: rond5((m / 100) * tempo), meters: m, uitleg };
}

function sessie(sport: DuurSport, rol: DuurRol, minuten: number, titel: string, uitleg: string, intensiteit: DuurIntensiteit = "rustig"): DuurSessieVoorstel {
  return { sport, rol, titel, intensiteit, minuten: rond5(minuten), meters: null, uitleg };
}

const RUSTIG_UITLEG = "Zo rustig dat je nog makkelijk kunt praten.";

export function maakDuurschema(i: DuurInstellingen): Duurschema {
  controleer(i);
  const n = i.dagenPerWeek;
  const volumes = weekVolumes(i);
  const lanFractie = n === 2 ? 0.5 : n === 3 ? 0.4 : 0.35;
  const langMax = LANG_MAX[i.sport][sleutelVan(i)] ?? Infinity;
  const afstandDoel = i.doel === "afstand" ? AFSTANDEN[i.sport].find((x) => x.waarde === i.afstand)! : null;
  const loopWandel = i.sport === "hardlopen" && i.niveau === "beginner";
  const opmerkingen: string[] = [];

  const weken: DuurWeek[] = volumes.map((volume, idx) => {
    const week = idx + 1;
    const laatste = week === volumes.length && afstandDoel !== null;
    const herstel = !laatste && week % HERSTEL_ELKE === 0;
    const thema = laatste ? `Laatste week: rustiger, en dan ${afstandDoel!.label}` : herstel ? "Rustigere week: je lichaam bouwt op" : week === 1 ? "Rustig beginnen" : "Opbouw";
    const sessies: DuurSessieVoorstel[] = [];

    // Hardlopen vanaf nul: eerst wandelen en hardlopen afwisselen.
    if (loopWandel && week <= LOOP_WANDEL.length) {
      const [loop, wandel, keer] = LOOP_WANDEL[herstel ? Math.max(0, week - 2) : week - 1];
      for (let s = 0; s < n; s++) {
        const extra = s === n - 1 && !herstel ? 1 : 0;
        const k = keer + extra;
        sessies.push(
          sessie("hardlopen", s === n - 1 ? "lang" : "rustig", 10 + k * (loop + wandel), "Wandelen en hardlopen", `5 min wandelen, dan ${k}× (${getal(loop)} min rustig hardlopen, ${getal(wandel)} min wandelen), 5 min uitwandelen`),
        );
      }
      return { week, thema: week === 1 ? "Wandelen en hardlopen afwisselen" : thema, sessies };
    }

    // Kwaliteit (hard): beginners pas vanaf week 4, met 2 dagen pas vanaf week 3, niet in een rustigere week.
    const kwaliteitMag =
      !herstel &&
      (i.niveau === "gevorderd" ? n >= 3 || week >= 3 : week >= 4) &&
      !(loopWandel && week <= LOOP_WANDEL.length + 1) &&
      !(laatste && i.niveau === "beginner");

    if (i.sport === "zwemmen") {
      const verdeling = n === 2 ? [0.5, 0.5] : n === 3 ? [0.4, 0.3, 0.3] : [0.35, 0.25, 0.2, 0.2];
      verdeling.forEach((f, s) => {
        const rol: DuurRol = laatste && s === 0 ? "doel" : s === 0 ? "lang" : s === 1 && kwaliteitMag ? "kwaliteit" : "rustig";
        const meters = rol === "doel" ? afstandDoel!.waarde : volume * f;
        // Naar je afstand toe: het langste stuk aan één stuk groeit vanaf week 5 gelijkmatig van
        // 150 m (beginner) of 300 m naar ~80% van je doel in de week vóór de laatste.
        const begin = i.niveau === "beginner" ? 150 : 300;
        const doelStuk =
          afstandDoel && rol === "lang" && week > 4
            ? begin + ((afstandDoel.waarde * 0.8 - begin) * (week - 4)) / Math.max(1, volumes.length - 5)
            : null;
        sessies.push(zwemSessie(Math.max(meters, doelStuk ?? 0), rol, i.niveau, week, doelStuk && Math.min(doelStuk, afstandDoel!.waarde * 0.8)));
      });
      return { week, thema, sessies: sorteer(sessies) };
    }

    // Net klaar met wandelen en hardlopen afwisselen: eerst 25–35 minuten aan één stuk, niet meteen langer.
    const netDoorlopend = loopWandel && week <= LOOP_WANDEL.length + 2;
    const lang = Math.min(langMax, volume * lanFractie, netDoorlopend ? 35 : Infinity);
    let rest = volume - lang;
    if (laatste) {
      const doel = afstandDoel!;
      sessies.push(sessie(i.sport, "doel", schatMinuten(i, doel.waarde), "Je doel", `${doel.label} in je eigen tempo. Begin rustig, versnel pas als het goed gaat.`, "duur"));
    } else {
      sessies.push(sessie(i.sport, "lang", lang, i.sport === "hardlopen" ? "Lange duurloop" : "Lange rit", RUSTIG_UITLEG));
    }
    if (kwaliteitMag && n >= 2) {
      const it = intervalTekst(i.sport, week, i.niveau === "gevorderd");
      const totaal = Math.min(it.totaal, rest);
      sessies.push(sessie(i.sport, "kwaliteit", totaal, it.titel, it.uitleg, it.titel === "Tempo" ? "tempo" : "interval"));
      rest -= totaal;
    }
    const overig = n - sessies.length;
    for (let s = 0; s < overig; s++) {
      const minuten = Math.min(Math.max(20, rest / overig), netDoorlopend ? 30 : Infinity);
      sessies.push(sessie(i.sport, "rustig", minuten, i.sport === "hardlopen" ? "Rustige duurloop" : "Rustige rit", RUSTIG_UITLEG));
    }
    return { week, thema, sessies: sorteer(sessies) };
  });

  if (i.doel === "afvallen") {
    opmerkingen.push("Bewegen helpt bij afvallen vooral om het vol te houden en je spieren te sparen; het meeste doet je eten. Zie Lichaam voor je calorieën.");
  }
  if (i.sport === "hardlopen") {
    opmerkingen.push("Hardlopen belast je benen het meest. RSLNT zet harde loopsessies niet op of vlak voor een benentraining.");
  }
  if (i.sport === "zwemmen" && i.niveau === "beginner") {
    opmerkingen.push("Zwemmen is vooral techniek: een paar lessen of een clinic maakt elke baan makkelijker.");
  }
  opmerkingen.push("Pijn die tijdens of na het sporten erger wordt: een week rustiger, en houdt het aan, laat het nakijken.");

  const titel = afstandDoel ? `${DUUR_SPORTEN[i.sport]}: ${afstandDoel.label}` : `${DUUR_SPORTEN[i.sport]}: ${DUUR_DOELEN[i.doel].toLowerCase()}`;
  return {
    titel,
    uitleg: afstandDoel
      ? `${weken.length} weken naar ${afstandDoel.label}, ${n}× per week. Het meeste rustig, één keer per week harder, en elke 4e week rustiger.`
      : `${n}× per week. Het meeste rustig, één keer per week harder, en elke 4e week rustiger. Na ${DOORLOPEND_WEKEN} weken houd je dit niveau vast.`,
    weken,
    doorlopend: !afstandDoel,
    opmerkingen,
  };
}

/** Lang eerst in de lijst, dan kwaliteit, dan rustig: zo verdeelt verdeelOverWeek ze. */
function sorteer(sessies: DuurSessieVoorstel[]) {
  const volgorde: Record<DuurRol, number> = { doel: 0, lang: 1, kwaliteit: 2, rustig: 3 };
  return [...sessies].sort((a, b) => volgorde[a.rol] - volgorde[b.rol]);
}

/** Ruwe duur voor je doelafstand: rustig tempo, voor de agenda. */
function schatMinuten(i: DuurInstellingen, afstand: number) {
  const perKm = i.sport === "hardlopen" ? (i.niveau === "beginner" ? 7.5 : 6) : 60 / (i.niveau === "beginner" ? 20 : 25);
  return afstand * perKm;
}

/** Week n van het schema; voorbij het eind van een doorlopend schema blijft de laatste week gelden. */
export function weekUitSchema(schema: Duurschema, n: number): DuurWeek | null {
  if (n < 1) return null;
  if (n <= schema.weken.length) return schema.weken[n - 1];
  if (!schema.doorlopend) return null;
  const laatste = schema.weken[schema.weken.length - 1];
  return { ...laatste, week: n, thema: "Onderhoud: dit niveau vasthouden" };
}

/**
 * Zet de sessies van een week op je duurdagen. De lange sessie bij voorkeur in het weekend, de
 * harde sessie niet op of vlak vóór een benentraining (hardlopen en fietsen; Wetenschap #hybride).
 * @param dagen je duurdagen (1 = ma … 7 = zo)
 * @param benenDagen dagen met een zware benentraining
 */
export function verdeelOverWeek(sessies: DuurSessieVoorstel[], dagen: number[], benenDagen: number[]): Map<number, DuurSessieVoorstel> {
  const vrij = [...new Set(dagen)].sort((a, b) => a - b);
  const plek = new Map<number, DuurSessieVoorstel>();
  const benen = new Set(benenDagen);
  const zwaarVoorBenen = (s: DuurSessieVoorstel) => s.sport !== "zwemmen";
  const neem = (dag: number, s: DuurSessieVoorstel) => {
    plek.set(dag, s);
    vrij.splice(vrij.indexOf(dag), 1);
  };
  for (const s of sessies.slice(0, dagen.length)) {
    if (!vrij.length) break;
    let dag: number | undefined;
    if (s.rol === "lang" || s.rol === "doel") {
      dag = [...vrij].reverse().find((d) => d >= 6) ?? vrij[vrij.length - 1];
    } else if (s.rol === "kwaliteit" && zwaarVoorBenen(s)) {
      const morgenBenen = (d: number) => benen.has(d === 7 ? 1 : d + 1);
      dag = vrij.find((d) => !benen.has(d) && !morgenBenen(d)) ?? vrij.find((d) => !benen.has(d)) ?? vrij[0];
    } else {
      dag = vrij[0];
    }
    neem(dag, s);
  }
  return plek;
}

/** Een begin voor je duurdagen: dagen zonder krachttraining eerst, het weekend voor de lange sessie. */
export function standaardDuurdagen(aantal: number, krachtDagen: number[]): number[] {
  const kracht = new Set(krachtDagen);
  const voorkeur = [6, 2, 4, 7, 3, 5, 1];
  const vrij = voorkeur.filter((d) => !kracht.has(d));
  const rest = voorkeur.filter((d) => kracht.has(d));
  return [...vrij, ...rest].slice(0, aantal).sort((a, b) => a - b);
}
