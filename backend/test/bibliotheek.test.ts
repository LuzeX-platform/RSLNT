import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BRON_COMMIT, omzetten, type BronOefening } from "../src/bibliotheekOmzetten.js";
import { bibliotheek, kort, vergelijkbaar, zoekOefeningen } from "../src/bibliotheek.js";
import { CATALOGUS } from "../src/catalogus.js";
import { ALLE_SPIER_LABELS as SPIER_LABELS } from "../src/spieren.js";

const bron = (o: Partial<BronOefening> & Pick<BronOefening, "name" | "primaryMuscles">): BronOefening => ({
  id: o.name.replace(/\s+/g, "_"),
  force: null,
  level: "beginner",
  mechanic: "isolation",
  equipment: "dumbbell",
  secondaryMuscles: [],
  instructions: ["Stap één.", "  "],
  category: "strength",
  images: ["x/0.jpg"],
  ...o,
});

test("omzetten: schouders worden voor-, zij- of achterkant op naam en richting", () => {
  assert.deepEqual(omzetten(bron({ name: "Side Lateral Raise", primaryMuscles: ["shoulders"] })).spierenPrimair, ["side_delts"]);
  assert.deepEqual(omzetten(bron({ name: "Face Pull", primaryMuscles: ["shoulders"], force: "pull" })).spierenPrimair, ["rear_delts"]);
  assert.deepEqual(omzetten(bron({ name: "Upright Barbell Row", primaryMuscles: ["shoulders"], force: "pull", mechanic: "compound" })).spierenPrimair, ["side_delts"]);
  assert.deepEqual(omzetten(bron({ name: "Dumbbell Shoulder Press", primaryMuscles: ["shoulders"], force: "push", mechanic: "compound" })).spierenPrimair, ["front_delts"]);
  // Bij een roeibeweging is "shoulders" als hulpspier de achterkant.
  const roeien = omzetten(bron({ name: "Seated Cable Rows", primaryMuscles: ["middle back"], secondaryMuscles: ["shoulders", "biceps"], force: "pull", mechanic: "compound" }));
  assert.deepEqual(roeien.spierenSecundair, ["rear_delts", "biceps"]);
});

test("omzetten: materiaal, patroon, knie, per kant en lege uitlegregels", () => {
  const trap = omzetten(bron({ name: "Trap Bar Deadlift", primaryMuscles: ["quadriceps"], equipment: "other", mechanic: "compound" }));
  assert.equal(trap.materiaal, "trap_bar");
  assert.equal(trap.patroon, "knie_dominant");
  assert.equal(trap.knieGevoelig, true);
  assert.equal(trap.gewichtsstap, 5);
  assert.equal(omzetten(bron({ name: "EZ-Bar Curl", primaryMuscles: ["biceps"], equipment: "e-z curl bar" })).materiaal, "barbell");
  assert.equal(omzetten(bron({ name: "Kettlebell Row", primaryMuscles: ["middle back"], equipment: "kettlebells" })).materiaal, "kettlebell");
  assert.equal(omzetten(bron({ name: "Plank", primaryMuscles: ["abdominals"], equipment: null })).materiaal, "lichaamsgewicht");
  assert.equal(omzetten(bron({ name: "Leg Extensions", primaryMuscles: ["quadriceps"], equipment: "machine" })).patroon, "quad_isolatie");
  const curl = omzetten(bron({ name: "Seated Leg Curl", primaryMuscles: ["hamstrings"], equipment: "machine" }));
  assert.equal(curl.patroon, "hamstring_curl");
  assert.equal(curl.knieGevoelig, false);
  assert.equal(omzetten(bron({ name: "Quad Stretch", primaryMuscles: ["quadriceps"], category: "stretching" })).knieGevoelig, false);
  assert.equal(omzetten(bron({ name: "Quad Stretch", primaryMuscles: ["quadriceps"], category: "stretching" })).patroon, "overig");
  assert.equal(omzetten(bron({ name: "One-Arm Kettlebell Snatch", primaryMuscles: ["shoulders"], force: "pull", mechanic: "compound" })).patroon, "overig");
  assert.equal(omzetten(bron({ name: "Dumbbell Lunges", primaryMuscles: ["quadriceps"], mechanic: "compound" })).unilateraal, true);
  assert.deepEqual(omzetten(bron({ name: "Curl", primaryMuscles: ["biceps"] })).uitleg, ["Stap één."]);
});

test("bibliotheek.json: 876 oefeningen, unieke id's, vastgepinde bron", () => {
  const { bestand, perId } = bibliotheek();
  assert.equal(bestand.oefeningen.length, 876);
  assert.equal(perId.size, 876);
  assert.equal(bestand.commit, BRON_COMMIT);
  assert.match(bestand.licentie, /Unlicense/);
  for (const o of bestand.oefeningen) {
    for (const s of [...o.spierenPrimair, ...o.spierenSecundair]) {
      assert.ok(SPIER_LABELS[s], `${o.id}: spier ${s} heeft geen Nederlandse naam`);
    }
  }
});

test("catalogus: elke oefening bestaat in de bibliotheek, sleutels en namen uniek", () => {
  const { perId } = bibliotheek();
  const sleutels = new Set<string>();
  const namen = new Set<string>();
  for (const c of CATALOGUS) {
    assert.ok(perId.has(c.bibliotheekId), `${c.sleutel}: ${c.bibliotheekId} niet in bibliotheek`);
    assert.ok(!sleutels.has(c.sleutel), `dubbele sleutel ${c.sleutel}`);
    assert.ok(!namen.has(c.naam.toLowerCase()), `dubbele naam ${c.naam}`);
    assert.match(c.sleutel, /^[a-z0-9_]+$/);
    assert.notEqual(c.patroon, "overig");
    assert.ok(c.cue.length > 0, `${c.sleutel} heeft geen cue`);
    for (const s of [...c.spierenPrimair, ...c.spierenSecundair]) assert.ok(SPIER_LABELS[s], `${c.sleutel}: ${s}`);
    sleutels.add(c.sleutel);
    namen.add(c.naam.toLowerCase());
  }
});

test("catalogus: oefeningen uit Benen / Push / Pull hebben dezelfde sleutel en gegevens", () => {
  const programma = JSON.parse(readFileSync(new URL("../programmas/benen-push-pull.json", import.meta.url), "utf8"));
  const materiaal: Record<string, string> = { cable: "kabel", bodyweight: "lichaamsgewicht" };
  const perSleutel = new Map(CATALOGUS.map((c) => [c.sleutel, c]));
  for (const o of programma.exercises) {
    const c = perSleutel.get(o.id);
    assert.ok(c, `${o.id} ontbreekt in de catalogus`);
    assert.equal(c.materiaal, materiaal[o.equipment] ?? o.equipment, `${o.id}: materiaal`);
    assert.equal(Boolean(c.knieGevoelig), o.knee_sensitive, `${o.id}: knie-gevoelig`);
    assert.equal(c.gewichtsstap, o.increment_kg, `${o.id}: gewichtsstap`);
    assert.deepEqual(c.spierenPrimair, o.muscles_primary, `${o.id}: hoofdspieren`);
  }
});

test("zoeken: Nederlandse woorden, spiergroepen, knievriendelijk en basislijst eerst", () => {
  const lijst = bibliotheek().bestand.oefeningen;
  const bank = zoekOefeningen(lijst, { zoek: "bankdrukken" });
  assert.ok(bank.some((o) => o.id === "Barbell_Bench_Press_-_Medium_Grip"));
  assert.ok(bank.length > 5);
  assert.ok(zoekOefeningen(lijst, { zoek: "kuit" }).some((o) => o.id === "Standing_Calf_Raises"));
  // Zoeken op de Nederlandse spiernaam.
  assert.ok(zoekOefeningen(lijst, { zoek: "achterkant schouders" }).some((o) => o.id === "Face_Pull"));
  const benen = zoekOefeningen(lijst, { spier: "quads" });
  assert.ok(benen.every((o) => o.spierenPrimair.includes("quads") || o.spierenSecundair.includes("quads")));
  const knie = zoekOefeningen(lijst, { spier: "quads", knievriendelijk: true });
  assert.ok(!knie.some((o) => o.id === "Leg_Extensions" || o.id === "Leg_Press"));
  // Basislijst eerst: de eerste resultaten zijn bekende oefeningen.
  assert.equal(kort(zoekOefeningen(lijst, { zoek: "row" })[0]).basislijst, true);
  assert.equal(zoekOefeningen(lijst, { materiaal: "trap_bar" }).length, 1);
});

test("vergelijkbaar: zelfde patroon, zonder zichzelf", () => {
  const { perId, bestand } = bibliotheek();
  const leg = perId.get("Leg_Press")!;
  const lijst = vergelijkbaar(leg, bestand.oefeningen);
  assert.ok(lijst.length > 0 && lijst.length <= 8);
  assert.ok(lijst.every((o) => o.patroon === "knie_dominant" && o.id !== "Leg_Press"));
});
