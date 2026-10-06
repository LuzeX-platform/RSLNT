import { test } from "node:test";
import assert from "node:assert/strict";
import {
  kiesSplit,
  maakVoorstel,
  minimaleRust,
  minutenVoor,
  uitvoering,
  weekdoelen,
  type BestaandeOefening,
  type Blessure,
  type Doel,
  type Ervaring,
  type Voorkeuren,
} from "../src/generator.js";
import { valideerProgramma } from "../src/programmaImport.js";
import { CATALOGUS_PER_SLEUTEL } from "../src/catalogus.js";
import { bibliotheek } from "../src/bibliotheek.js";
import { fractioneleSets, SETS_PER_TRAINING_GRENS } from "../src/voortgang.js";
import { haalbaarheid } from "../src/lichaam.js";
import { verschuifDag } from "../src/datum.js";

const SPORTSCHOOL = ["dumbbell", "barbell", "trap_bar", "kabel", "machine", "stang"];
const basis: Voorkeuren = {
  doel: "spiermassa",
  ervaring: "gevorderd",
  dagenPerWeek: 3,
  minutenPerTraining: 75,
  materiaal: SPORTSCHOOL,
  blessures: [],
  favorieten: [],
  uitgesloten: [],
  focus: [],
};
const voorstel = (v: Partial<Voorkeuren> = {}, bestaand: BestaandeOefening[] = []) =>
  maakVoorstel({
    voorkeuren: { ...basis, ...v },
    bestaand,
    bibliotheekFavorieten: (v.favorieten ?? []).map((id) => bibliotheek().perId.get(id)!).filter(Boolean),
    dag: "2026-10-06",
  });

test("split per aantal dagen", () => {
  assert.equal(kiesSplit(2).sessies.length, 2);
  assert.equal(kiesSplit(3).sessies.length, 3);
  assert.equal(kiesSplit(4).sessies.length, 4);
  assert.equal(kiesSplit(5).sessies.length, 5);
  assert.equal(kiesSplit(6).sessies.length, 6);
  assert.match(kiesSplit(4).naam, /Boven \/ onder/);
});

test("weekdoelen: per doel en ervaring, focus +30%, kleine spieren minder", () => {
  const d = weekdoelen({ doel: "spiermassa", ervaring: "gevorderd", focus: [] });
  assert.equal(d.quads, 12);
  assert.equal(d.biceps, 10);
  assert.equal(d.abs, 7);
  assert.equal(weekdoelen({ doel: "spiermassa", ervaring: "gevorderd", focus: ["side_delts"] }).side_delts, 16);
  assert.equal(weekdoelen({ doel: "fit", ervaring: "beginner", focus: [] }).chest, 6);
  assert.equal(d.front_delts, undefined);
});

test("uitvoering: reps, RIR en rust per doel; beginner en knie voorzichtiger", () => {
  const groot = { mechaniek: "compound", patroon: "knie_dominant" as const, hoofdlift: true, knieGevoelig: false };
  assert.deepEqual(uitvoering({ doel: "kracht", ervaring: "gevorderd", blessures: [] }, groot, 1), { repMin: 4, repMax: 6, rir: 2, rust: 180 });
  assert.deepEqual(uitvoering({ doel: "spiermassa", ervaring: "gevorderd", blessures: [] }, groot, 1), { repMin: 6, repMax: 10, rir: 2, rust: 150 });
  assert.deepEqual(uitvoering({ doel: "spiermassa", ervaring: "beginner", blessures: [] }, groot, 1), { repMin: 8, repMax: 12, rir: 3, rust: 150 });
  const knie = { ...groot, knieGevoelig: true };
  assert.deepEqual(uitvoering({ doel: "spiermassa", ervaring: "gevorderd", blessures: ["knie"] }, knie, 1), { repMin: 10, repMax: 15, rir: 3, rust: 150 });
  const zij = { mechaniek: "isolation", patroon: "zijkant_schouder" as const, hoofdlift: false, knieGevoelig: false };
  assert.deepEqual(uitvoering({ doel: "spiermassa", ervaring: "gevorderd", blessures: [] }, zij, 2), { repMin: 12, repMax: 15, rir: 1, rust: 75 });
});

test("rust en tijd: ondergrens 90/60 s, kracht langer; minuten per training", () => {
  assert.equal(minimaleRust("spiermassa", { patroon: "horizontaal_duwen", prioriteit: 1 }), 90);
  assert.equal(minimaleRust("spiermassa", { patroon: "biceps", prioriteit: 2 }), 60);
  assert.equal(minimaleRust("kracht", { patroon: "knie_dominant", prioriteit: 1 }), 180);
  // 8 opwarmen + per oefening 1 wissel + sets × 45 s werk + rust na elke set.
  assert.equal(minutenVoor([{ sets: 3, rust: 120, perKant: false }]), Math.round(8 + 1 + (3 * 45 + 2 * 120) / 60 + 2));
  assert.equal(minutenVoor([{ sets: 2, rust: 60, perKant: true }]), Math.round(8 + 1 + (2 * 90 + 60) / 60 + 1));
});

// Elke combinatie moet een programma opleveren dat de import zonder fouten of waarschuwingen accepteert,
// en dat zich aan de harde grenzen houdt.
const doelen: Doel[] = ["spiermassa", "kracht", "vetverlies", "fit"];
const ervaringen: Ervaring[] = ["beginner", "gevorderd", "ervaren"];
const opstellingen: { materiaal: string[]; blessures: Blessure[]; minuten: number }[] = [
  { materiaal: SPORTSCHOOL, blessures: [], minuten: 75 },
  { materiaal: SPORTSCHOOL, blessures: ["knie"], minuten: 60 },
  { materiaal: ["dumbbell", "kabel", "machine"], blessures: ["schouder", "rug"], minuten: 45 },
  { materiaal: ["dumbbell", "band"], blessures: ["knie", "schouder"], minuten: 45 },
  { materiaal: [], blessures: [], minuten: 30 },
];

test("alle combinaties: geldig bestand, binnen tijd, max 11 sets per spier, blessures en materiaal gerespecteerd", () => {
  for (const doel of doelen) {
    for (const ervaring of ervaringen) {
      for (let dagen = 2; dagen <= 6; dagen++) {
        for (const o of opstellingen) {
          const naam = `${doel}/${ervaring}/${dagen}d/${o.materiaal.join("+") || "thuis"}/${o.blessures.join("+")}`;
          const r = voorstel({ doel, ervaring, dagenPerWeek: dagen, minutenPerTraining: o.minuten, materiaal: o.materiaal, blessures: o.blessures });
          const val = valideerProgramma(r.bestand);
          assert.ok(val.ok, `${naam}: ${!val.ok ? val.fouten.join("; ") : ""}`);
          assert.deepEqual(val.ok && val.waarschuwingen, [], naam);
          assert.equal(r.sessies.length, kiesSplit(dagen).sessies.length, naam);
          const toegestaan = new Set(["lichaamsgewicht", ...o.materiaal]);
          for (const s of r.sessies) {
            assert.ok(s.regels.length > 0, `${naam} ${s.code}: lege training`);
            const langer = r.opmerkingen.some((t) => t.startsWith(s.naam));
            assert.ok(s.minuten <= o.minuten || langer, `${naam} ${s.code}: ${s.minuten} min zonder uitleg`);
            const vol = fractioneleSets(s.regels.map((x) => ({ spierenPrimair: x.spierenPrimair, spierenSecundair: x.spierenSecundair, sets: x.sets })));
            for (const [spier, sets] of Object.entries(vol)) assert.ok(sets <= SETS_PER_TRAINING_GRENS, `${naam} ${s.code}: ${spier} ${sets}`);
            if (o.blessures.includes("knie")) {
              assert.ok(s.regels.filter((x) => x.knieGevoelig).length <= 1, `${naam} ${s.code}: te veel knie`);
              assert.ok(s.regels.filter((x) => x.knieGevoelig).every((x) => x.sets <= 3 && x.repMin >= 10), `${naam} ${s.code}: knie zwaar`);
            }
            for (const x of s.regels) {
              const c = CATALOGUS_PER_SLEUTEL.get(x.sleutel)!;
              assert.ok(c, `${naam}: ${x.sleutel} niet in catalogus`);
              assert.ok(toegestaan.has(c.materiaal), `${naam}: ${x.sleutel} vraagt ${c.materiaal}`);
              for (const n of c.nodig ?? []) assert.ok(toegestaan.has(n), `${naam}: ${x.sleutel} vraagt ${n}`);
              if (o.blessures.includes("schouder")) assert.ok(!c.schouderBelastend, `${naam}: ${x.sleutel} schouder`);
              if (o.blessures.includes("rug")) assert.ok(!c.rugBelastend, `${naam}: ${x.sleutel} rug`);
              if (ervaring === "beginner") assert.ok(c.niveau < 3, `${naam}: ${x.sleutel} te moeilijk`);
              assert.ok(x.sets >= 2 && x.sets <= 4, `${naam}: ${x.sleutel} ${x.sets} sets`);
              assert.ok(x.repMin < x.repMax, `${naam}: ${x.sleutel} reps`);
            }
          }
        }
      }
    }
  }
});

test("geen oefening twee keer in één training; in een week zo gevarieerd als het kan", () => {
  const r = voorstel({ dagenPerWeek: 3 });
  for (const s of r.sessies) assert.equal(new Set(s.regels.map((x) => x.sleutel)).size, s.regels.length);
  const knie = r.sessies.flatMap((s) => s.regels.filter((x) => x.patroon === "knie_dominant").map((x) => x.sleutel));
  assert.equal(new Set(knie).size, knie.length, "A en C krijgen een andere squatvariant");
});

test("kracht: hoofdliften met de stang en 4–6 reps", () => {
  const r = voorstel({ doel: "kracht", dagenPerWeek: 4 });
  const groot = r.sessies.flatMap((s) => s.regels).filter((x) => x.prioriteit === 1 && CATALOGUS_PER_SLEUTEL.get(x.sleutel)?.hoofdlift);
  assert.ok(groot.length >= 4);
  assert.ok(groot.some((x) => x.sleutel === "bench_press"));
  assert.ok(groot.every((x) => x.repMin === 4 && x.repMax === 6));
});

test("favorieten gaan voor, ook buiten de basislijst; uitgesloten komt er niet in", () => {
  const met = voorstel({ favorieten: ["Hack_Squat", "Barbell_Full_Squat"], uitgesloten: ["Leg_Press", "Romanian_Deadlift"] });
  const alle = met.sessies.flatMap((s) => s.regels);
  assert.ok(alle.some((x) => x.sleutel === "hack_squat"));
  const vrij = alle.find((x) => x.sleutel === "barbell_full_squat");
  assert.ok(vrij, "favoriet uit de bibliotheek doet mee");
  assert.equal(vrij.bibliotheekId, "Barbell_Full_Squat");
  assert.ok(!alle.some((x) => x.sleutel === "leg_press" || x.sleutel === "romanian_deadlift"));
  const bestand = met.bestand as { exercises: { id: string; library_id?: string; equipment: string }[] };
  const inBestand = bestand.exercises.find((e) => e.id === "barbell_full_squat")!;
  assert.equal(inBestand.library_id, "Barbell_Full_Squat");
  assert.equal(inBestand.equipment, "barbell");
});

test("bestaande oefeningen: eigen gegevens blijven, geschiedenis gaat voor, naam wordt herkend", () => {
  const bestaand: BestaandeOefening[] = [
    {
      sleutel: "hack_squat",
      naam: "Hack squat",
      materiaal: "machine",
      gewichtsstap: 10,
      perKant: false,
      spierenPrimair: ["quads", "glutes"],
      spierenSecundair: [],
      mechaniek: "compound",
      unilateraal: false,
      knieGevoelig: true,
      alternatieven: ["mijn_squat"],
      bibliotheekId: "Hack_Squat",
      heeftGeschiedenis: true,
    },
    {
      sleutel: "mijn_squat",
      naam: "Mijn squat",
      materiaal: "machine",
      gewichtsstap: 5,
      perKant: false,
      spierenPrimair: ["quads"],
      spierenSecundair: [],
      mechaniek: "compound",
      unilateraal: false,
      knieGevoelig: true,
      alternatieven: [],
      bibliotheekId: null,
      heeftGeschiedenis: true,
    },
    {
      sleutel: "biceps_curl",
      naam: "Dumbbell curl",
      materiaal: "dumbbell",
      gewichtsstap: 2,
      perKant: false,
      spierenPrimair: ["biceps"],
      spierenSecundair: [],
      mechaniek: null,
      unilateraal: false,
      knieGevoelig: false,
      alternatieven: [],
      bibliotheekId: null,
      heeftGeschiedenis: false,
    },
  ];
  const r = voorstel({ dagenPerWeek: 2, uitgesloten: ["Incline_Dumbbell_Curl", "Hammer_Curls"] }, bestaand);
  const alle = r.sessies.flatMap((s) => s.regels);
  assert.equal(alle.find((x) => x.patroon === "knie_dominant")?.sleutel, "hack_squat", "geschiedenis gaat voor");
  const bestand = r.bestand as { exercises: { id: string; name: string; increment_kg: number; alternatives: string[] }[] };
  const hack = bestand.exercises.find((e) => e.id === "hack_squat")!;
  assert.equal(hack.increment_kg, 10, "eigen gewichtsstap blijft");
  assert.ok(hack.alternatives.includes("mijn_squat"), "eigen alternatief blijft");
  assert.ok(bestand.exercises.some((e) => e.id === "mijn_squat"), "en staat in het bestand");
  // "Dumbbell curl" bestaat al onder een andere sleutel: die wordt gebruikt, geen naamconflict.
  assert.ok(!bestand.exercises.some((e) => e.id === "db_curl"));
  assert.ok(alle.some((x) => x.sleutel === "biceps_curl"));
  assert.ok(valideerProgramma(r.bestand).ok);
});

test("te weinig tijd: eerst kortere rust en minder kleine oefeningen, met uitleg", () => {
  const r = voorstel({ dagenPerWeek: 2, minutenPerTraining: 40 });
  assert.ok(r.opmerkingen.some((t) => /rust korter/.test(t)));
  assert.ok(r.opmerkingen.some((t) => /Onder je weekdoel/.test(t)));
  for (const s of r.sessies) {
    assert.ok(s.regels.some((x) => x.prioriteit === 1));
    // De grote oefeningen blijven eerder staan dan de kleine.
    const grootMin = Math.min(...s.regels.filter((x) => x.prioriteit === 1).map((x) => x.sets));
    assert.ok(grootMin >= 2);
  }
});

test("thuis zonder materiaal: alleen lichaamsgewicht, en een uitleg wat er ontbreekt", () => {
  const r = voorstel({ materiaal: [], dagenPerWeek: 3, minutenPerTraining: 45 });
  const alle = r.sessies.flatMap((s) => s.regels);
  assert.ok(alle.every((x) => CATALOGUS_PER_SLEUTEL.get(x.sleutel)?.materiaal === "lichaamsgewicht"));
  assert.ok(r.opmerkingen.some((t) => /Geen oefening voor/.test(t)));
});

test("haalbaarheid: 81 → 90 kg op 1 maart is te snel; zonder streefdatum-druk haalbaar", () => {
  const h = haalbaarheid(81, 90, "2027-03-01", "2026-10-06");
  assert.equal(h.oordeel, "te_snel");
  assert.equal(h.aanbevolen.min, 0.2);
  assert.equal(h.aanbevolen.max, 0.41);
  assert.equal(h.nodigPerWeek, 0.43);
  assert.equal(h.vroegst, verschuifDag("2026-10-06", 22 * 7));
  assert.equal(h.uiterlijk, verschuifDag("2026-10-06", 45 * 7));
  assert.equal(haalbaarheid(81, 90, "2027-06-01", "2026-10-06").oordeel, "haalbaar");
  assert.equal(haalbaarheid(81, 90, "2028-06-01", "2026-10-06").oordeel, "ruim");
  assert.equal(haalbaarheid(81, 90, "2026-09-01", "2026-10-06").oordeel, "verlopen");
  assert.equal(haalbaarheid(81, 81, "2027-06-01", "2026-10-06").oordeel, "bereikt");
  // Afvallen: 0,5–1% per week.
  const af = haalbaarheid(100, 90, "2027-01-01", "2026-10-06");
  assert.deepEqual(af.aanbevolen, { min: 0.5, max: 1 });
  assert.equal(af.oordeel, "haalbaar");
  assert.ok(af.nodigPerWeek < 0);
});
