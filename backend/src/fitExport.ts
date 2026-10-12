import { createHash } from "node:crypto";
import { Encoder, Profile, Utils } from "@garmin/fitsdk";
import type {
  ActivityMesg,
  DeviceInfoMesg,
  Encodable,
  EventMesg,
  FileIdMesg,
  LapMesg,
  Mesg,
  RecordMesg,
  SessionMesg,
  SetMesg,
  SportMesg,
} from "@garmin/fitsdk";
import { bibliotheek, inCatalogus } from "./bibliotheek.js";
import type { Patroon } from "./bibliotheekOmzetten.js";
import { TIJDZONE } from "./datum.js";

// Een afgeronde training als FIT-bestand (krachttraining) om in Garmin Connect te importeren.
// FIT is het open formaat van Garmin; we schrijven het met de officiële FIT SDK. Per set: reps,
// gewicht en de oefening in Garmins eigen indeling (categorie + naam), zodat Connect de sets en
// spiergroepen herkent. Hartslag en calorieën hebben we niet; die laten we weg.

/** [Garmin-categorie, Garmin-oefeningnaam]. Zonder naam toont Connect alleen de categorie. */
type GarminOefening = readonly [categorie: string, naam?: string];

// De basislijst (catalogus.ts) op sleutel. Waar Garmin de oefening niet precies kent, de
// dichtstbijzijnde beweging; is het alleen de uitvoering die verschilt (machine i.p.v. stang), dan
// liever alleen de categorie dan een naam die iets anders belooft.
const PER_SLEUTEL: Record<string, GarminOefening> = {
  leg_press: ["squat", "legPress"],
  goblet_squat: ["squat", "gobletSquat"],
  hack_squat: ["squat", "barbellHackSquat"],
  trap_bar_deadlift: ["deadlift", "trapBarDeadlift"],
  back_squat: ["squat", "barbellBackSquat"],
  box_squat: ["squat", "barbellBoxSquat"],
  bulgarian_split_squat: ["lunge", "dumbbellBulgarianSplitSquat"],
  reverse_lunge: ["lunge", "dumbbellReverseLunge"],
  step_up: ["squat", "dumbbellStepUp"],
  kettlebell_goblet_squat: ["squat", "kettlebellSquat"],
  bodyweight_squat: ["squat", "airSquat"],
  romanian_deadlift: ["deadlift", "romanianDeadlift"],
  db_romanian_deadlift: ["deadlift", "dumbbellStraightLegDeadlift"],
  hip_thrust: ["hipRaise", "barbellHipThrustWithBench"],
  back_extension_45: ["hyperextension"],
  cable_pull_through: ["chop", "cablePullThrough"],
  deadlift: ["deadlift", "barbellDeadlift"],
  kettlebell_swing: ["hipRaise", "kettlebellSwing"],
  single_leg_rdl: ["deadlift", "singleLegRomanianDeadliftWithDumbbell"],
  glute_bridge: ["hipRaise", "hipRaise"],
  seated_leg_curl: ["legCurl", "legCurl"],
  lying_leg_curl: ["legCurl", "legCurl"],
  ball_leg_curl: ["legCurl", "swissBallHipRaiseAndLegCurl"],
  leg_extension: ["bandedExercises", "legExtension"],
  db_bench_press: ["benchPress", "dumbbellBenchPress"],
  machine_chest_press: ["benchPress"],
  incline_db_press: ["benchPress", "inclineDumbbellBenchPress"],
  bench_press: ["benchPress", "barbellBenchPress"],
  incline_machine_press: ["benchPress"],
  kettlebell_floor_press: ["benchPress", "kettlebellChestPress"],
  push_up: ["pushUp", "pushUp"],
  incline_push_up: ["pushUp", "inclinePushUp"],
  dips: ["tricepsExtension", "bodyWeightDip"],
  seated_db_shoulder_press: ["shoulderPress", "seatedDumbbellShoulderPress"],
  machine_shoulder_press: ["shoulderPress"],
  overhead_press: ["shoulderPress", "overheadBarbellPress"],
  kettlebell_press: ["shoulderPress"],
  band_shoulder_press: ["shoulderPress"],
  seated_cable_row: ["row", "seatedCableRow"],
  chest_supported_row: ["row", "chestSupportedDumbbellRow"],
  one_arm_db_row: ["row", "dumbbellRow"],
  barbell_row: ["row", "barbellRow"],
  kettlebell_row: ["row", "kettlebellRow"],
  inverted_row: ["row", "invertedRow"],
  lat_pulldown: ["pullUp", "latPulldown"],
  assisted_pull_up: ["pullUp", "bandAssistedPullUp"],
  pull_up: ["pullUp", "pullUp"],
  chin_up: ["pullUp", "chinUp"],
  db_pullover: ["pullUp"],
  straight_arm_pulldown: ["pullUp", "straightArmPulldown"],
  cable_fly: ["flye", "cableCrossover"],
  pec_deck: ["flye"],
  db_fly: ["flye", "dumbbellFlye"],
  lateral_raise: ["lateralRaise", "dumbbellLateralRaise"],
  cable_lateral_raise: ["lateralRaise", "oneArmCableLateralRaise"],
  band_lateral_raise: ["bandedExercises", "lateralRaise"],
  face_pull: ["row", "facePull"],
  reverse_pec_deck: ["flye"],
  db_reverse_fly: ["lateralRaise", "bentOverLateralRaise"],
  band_pull_apart: ["bandedExercises", "pullApart"],
  incline_db_curl: ["curl", "inclineDumbbellBicepsCurl"],
  hammer_curl: ["curl", "dumbbellHammerCurl"],
  db_curl: ["curl", "dumbbellBicepsCurl"],
  ez_bar_curl: ["curl", "standingEzBarBicepsCurl"],
  cable_curl: ["curl", "cableBicepsCurl"],
  rope_hammer_curl: ["curl", "cableHammerCurl"],
  machine_preacher_curl: ["curl"],
  triceps_pushdown: ["tricepsExtension", "tricepsPressdown"],
  cable_overhead_triceps_extension: ["tricepsExtension", "cableOverheadTricepsExtension"],
  db_overhead_triceps_extension: ["tricepsExtension", "overheadDumbbellTricepsExtension"],
  ez_skullcrusher: ["tricepsExtension", "lyingEzBarTricepsExtension"],
  close_grip_bench_press: ["benchPress", "closeGripBarbellBenchPress"],
  kettlebell_overhead_extension: ["tricepsExtension"],
  close_push_up: ["pushUp", "closeHandsPushUp"],
  standing_calf_raise: ["calfRaise", "standingCalfRaise"],
  seated_calf_raise: ["calfRaise", "seatedCalfRaise"],
  leg_press_calf_raise: ["calfRaise"],
  db_calf_raise: ["calfRaise", "standingDumbbellCalfRaise"],
  cable_crunch: ["crunch", "kneelingCableCrunch"],
  dead_bug: ["hipStability", "deadBug"],
  ab_crunch_machine: ["crunch", "crunch"],
  reverse_crunch: ["crunch", "reverseCrunch"],
  pallof_press: ["core"],
  hanging_leg_raise: ["legRaise", "hangingLegRaise"],
};

// Buiten de basislijst: op bewegingspatroon (oefeningen uit de bibliotheek) en anders op de
// eerste primaire spier (eigen oefeningen uit een programmabestand).
const PER_PATROON: Record<Patroon, GarminOefening> = {
  knie_dominant: ["squat"],
  heup_dominant: ["deadlift"],
  horizontaal_duwen: ["benchPress"],
  verticaal_duwen: ["shoulderPress"],
  horizontaal_trekken: ["row"],
  verticaal_trekken: ["pullUp"],
  quad_isolatie: ["bandedExercises", "legExtension"],
  hamstring_curl: ["legCurl", "legCurl"],
  borst_isolatie: ["flye"],
  zijkant_schouder: ["lateralRaise"],
  achterkant_schouder: ["lateralRaise"],
  biceps: ["curl"],
  triceps: ["tricepsExtension"],
  kuiten: ["calfRaise"],
  buik: ["core"],
  overig: ["unknown"],
};

const PER_SPIER: Record<string, GarminOefening> = {
  quads: ["squat"],
  glutes: ["hipRaise"],
  hamstrings: ["legCurl"],
  calves: ["calfRaise"],
  adductors: ["hipStability"],
  chest: ["benchPress"],
  front_delts: ["shoulderPress"],
  side_delts: ["lateralRaise"],
  rear_delts: ["lateralRaise"],
  triceps: ["tricepsExtension"],
  biceps: ["curl"],
  forearms: ["curl"],
  lats: ["pullUp"],
  upper_back: ["row"],
  lower_back: ["hyperextension"],
  abs: ["core"],
};

function omgekeerd(type: string): Map<string, number> {
  const waarden = Profile.types[type];
  if (!waarden) throw new Error(`FIT-profiel kent type ${type} niet`);
  return new Map(Object.entries(waarden).map(([nummer, naam]) => [naam, Number(nummer)]));
}

const CATEGORIEEN = omgekeerd("exerciseCategory");

/** Naar de getallen die in het bestand komen. Gooit bij een tikfout, zodat de tests die vangen. */
function alsNummers([categorie, naam]: GarminOefening): { categorie: number; naam?: number } {
  const c = CATEGORIEEN.get(categorie);
  if (c === undefined) throw new Error(`Onbekende Garmin-categorie ${categorie}`);
  if (naam === undefined) return { categorie: c };
  const n = omgekeerd(`${categorie}ExerciseName`).get(naam);
  if (n === undefined) throw new Error(`Onbekende Garmin-oefening ${categorie}.${naam}`);
  return { categorie: c, naam: n };
}

/** Alle koppelingen vooraf omgezet: een fout in de tabel valt meteen bij het starten op. */
const ONBEKEND: GarminOefening = ["unknown"];
const NUMMERS = new Map(
  [...Object.values(PER_SLEUTEL), ...Object.values(PER_PATROON), ...Object.values(PER_SPIER), ONBEKEND].map((v) => [v, alsNummers(v)]),
);

export interface FitOefeningInvoer {
  sleutel: string;
  bibliotheekId: string | null;
  spierenPrimair: string[];
}

export function garminOefening(o: FitOefeningInvoer): { categorie: number; naam?: number } {
  const bron = o.bibliotheekId ? bibliotheek().perId.get(o.bibliotheekId) : undefined;
  const keuze =
    PER_SLEUTEL[o.sleutel] ??
    (o.bibliotheekId ? PER_SLEUTEL[inCatalogus(o.bibliotheekId)?.sleutel ?? ""] : undefined) ??
    (bron ? PER_PATROON[bron.patroon] : undefined) ??
    PER_SPIER[o.spierenPrimair[0] ?? ""] ??
    ONBEKEND;
  return NUMMERS.get(keuze) ?? alsNummers(keuze);
}

export interface FitSet {
  gewicht: number | null;
  reps: number;
  opgeslagenOp: Date;
}

export interface FitTraining {
  id: string;
  titel: string;
  datum: Date;
  afgerondOp: Date | null;
  oefeningen: (FitOefeningInvoer & { rustSeconden: number | null; sets: FitSet[] })[];
}

export interface Blok {
  soort: "actief" | "rust";
  /** Unix-milliseconden, op hele seconden. */
  start: number;
  eind: number;
  oefening?: number;
  set?: FitSet;
}

const SECONDE = 1000;
const MINUUT = 60 * SECONDE;

/** Hoe lang een set duurde weten we niet; ongeveer 4 seconden per herhaling. */
export function actieveDuur(reps: number): number {
  return Math.min(90, Math.max(20, reps * 4)) * SECONDE;
}

const opSeconde = (ms: number) => Math.floor(ms / SECONDE) * SECONDE;

/**
 * Wanneer elke set plaatsvond. Bij het loggen tijdens de training is het moment van opslaan het
 * einde van de set: die tijden gebruiken we, met rust ertussen. Zijn ze onbruikbaar (alles achteraf
 * in één keer ingevuld, later nog een set aangepast), dan een nette reconstructie vanaf de start:
 * set, de rusttijd uit het schema, volgende set.
 */
export function tijdlijn(t: FitTraining): { blokken: Blok[]; echteTijden: boolean } {
  const sets = t.oefeningen.flatMap((o, oefening) => o.sets.map((set) => ({ oefening, set, rust: o.rustSeconden })));
  if (sets.length === 0) return { blokken: [], echteTijden: false };

  const opTijd = [...sets].sort((a, b) => a.set.opgeslagenOp.getTime() - b.set.opgeslagenOp.getTime());
  const tijden = opTijd.map((s) => opSeconde(s.set.opgeslagenOp.getTime()));
  const bruikbaar =
    tijden[0] >= t.datum.getTime() - MINUUT &&
    (t.afgerondOp === null || tijden[tijden.length - 1] <= t.afgerondOp.getTime() + MINUUT) &&
    tijden.every((tijd, i) => i === 0 || (tijd - tijden[i - 1] >= 15 * SECONDE && tijd - tijden[i - 1] <= 45 * MINUUT));

  const blokken: Blok[] = [];
  if (bruikbaar) {
    // Begin: de start van de training, maar hoogstens een kwartier voor de eerste set (wie de
    // training thuis al opende, heeft niet een uur getraind).
    const eersteStart = tijden[0] - actieveDuur(opTijd[0].set.reps);
    let vorige = Math.max(opSeconde(t.datum.getTime()), eersteStart - 15 * MINUUT);
    opTijd.forEach(({ oefening, set }, i) => {
      const eind = tijden[i];
      const start = Math.max(vorige, eind - actieveDuur(set.reps));
      if (start > vorige) blokken.push({ soort: "rust", start: vorige, eind: start });
      blokken.push({ soort: "actief", start, eind, oefening, set });
      vorige = eind;
    });
  } else {
    let tijd = opSeconde(t.datum.getTime());
    sets.forEach(({ oefening, set, rust }, i) => {
      const eind = tijd + actieveDuur(set.reps);
      blokken.push({ soort: "actief", start: tijd, eind, oefening, set });
      tijd = eind;
      if (i < sets.length - 1) {
        const rustEind = tijd + (rust ?? 90) * SECONDE;
        blokken.push({ soort: "rust", start: tijd, eind: rustEind });
        tijd = rustEind;
      }
    });
  }
  return { blokken, echteTijden: bruikbaar };
}

/** Verschil tussen Nederlandse tijd en UTC op dat moment, in seconden (zomer- of wintertijd). */
export function tijdzoneVerschil(moment: Date): number {
  const delen = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TIJDZONE,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
      .formatToParts(moment)
      .map((p) => [p.type, Number(p.value)]),
  );
  const lokaal = Date.UTC(delen.year, delen.month - 1, delen.day, delen.hour, delen.minute, delen.second);
  return Math.round((lokaal - opSeconde(moment.getTime())) / SECONDE);
}

/** Vast per training: Garmin Connect herkent zo een tweede import van hetzelfde bestand. */
function serienummer(trainingId: string): number {
  return createHash("sha256").update(trainingId).digest().readUInt32BE(0) || 1;
}

const PRODUCT = { manufacturer: "development", product: 1, productName: "LuzeX RSLNT" } as const;

export function maakFit(t: FitTraining): Uint8Array {
  const { blokken } = tijdlijn(t);
  if (blokken.length === 0) throw new Error("Een training zonder sets kun je niet exporteren");
  const fit = (ms: number) => Utils.convertDateToDateTime(new Date(ms));
  const start = blokken[0].start;
  const eind = blokken[blokken.length - 1].eind;
  const duur = (eind - start) / SECONDE;
  const sport = { sport: "training", subSport: "strengthTraining" } as const;
  const M = Profile.MesgNum;

  const encoder = new Encoder();
  const schrijf = <T extends Mesg>(mesg: Encodable<T>) => encoder.writeMesg(mesg);
  schrijf<FileIdMesg>({
    mesgNum: M.FILE_ID,
    type: "activity",
    ...PRODUCT,
    timeCreated: fit(t.afgerondOp ? opSeconde(t.afgerondOp.getTime()) : eind),
    serialNumber: serienummer(t.id),
  });
  schrijf<DeviceInfoMesg>({ mesgNum: M.DEVICE_INFO, deviceIndex: "creator", ...PRODUCT, softwareVersion: 1, timestamp: fit(start) });
  schrijf<SportMesg>({ mesgNum: M.SPORT, ...sport, name: t.titel.slice(0, 40) });
  schrijf<EventMesg>({ mesgNum: M.EVENT, timestamp: fit(start), event: "timer", eventType: "start" });
  // Een activiteit hoort record-berichten te hebben; zonder sensoren alleen het tijdstip, bij
  // het begin en bij elk einde van een set of rust.
  schrijf<RecordMesg>({ mesgNum: M.RECORD, timestamp: fit(start) });
  blokken.forEach((b, i) => {
    schrijf<RecordMesg>({ mesgNum: M.RECORD, timestamp: fit(b.eind) });
    const basis = {
      mesgNum: M.SET,
      messageIndex: i,
      timestamp: fit(b.eind),
      startTime: fit(b.start),
      duration: (b.eind - b.start) / SECONDE,
    };
    if (b.soort === "rust" || !b.set || b.oefening === undefined) {
      schrijf<SetMesg>({ ...basis, setType: "rest" });
      return;
    }
    const g = garminOefening(t.oefeningen[b.oefening]);
    schrijf<SetMesg>({
      ...basis,
      setType: "active",
      repetitions: b.set.reps,
      ...(b.set.gewicht !== null ? { weight: b.set.gewicht, weightDisplayUnit: "kilogram" } : {}),
      category: [g.categorie],
      ...(g.naam !== undefined ? { categorySubtype: [g.naam] } : {}),
    });
  });
  schrijf<EventMesg>({ mesgNum: M.EVENT, timestamp: fit(eind), event: "timer", eventType: "stop" });
  const totaal = { timestamp: fit(eind), startTime: fit(start), totalElapsedTime: duur, totalTimerTime: duur, ...sport };
  schrijf<LapMesg>({ mesgNum: M.LAP, messageIndex: 0, ...totaal });
  schrijf<SessionMesg>({ mesgNum: M.SESSION, messageIndex: 0, ...totaal, firstLapIndex: 0, numLaps: 1 });
  schrijf<ActivityMesg>({
    mesgNum: M.ACTIVITY,
    timestamp: fit(eind),
    numSessions: 1,
    totalTimerTime: duur,
    type: "manual",
    event: "activity",
    eventType: "stop",
    localTimestamp: fit(eind) + tijdzoneVerschil(new Date(eind)),
  });
  return encoder.close();
}
