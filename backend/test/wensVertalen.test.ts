import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseerWens } from "../src/wensVertalen.js";

test("wens: alleen echte opties komen door, de rest valt weg", () => {
  const { keuzes, uitleg, nietGelukt } = normaliseerWens({
    doel: "spiermassa",
    ervaring: "pro-atleet", // bestaat niet
    dagenPerWeek: 3,
    minutenPerTraining: 50, // geen knop: naar de dichtstbijzijnde
    materiaal: ["dumbbell", "dumbbell", "raket"],
    blessures: ["schouder"],
    focus: ["glutes", "lats", "chest", "biceps"], // hoogstens drie
    doelgewicht: 72.46,
    uitleg: "Ik heb spiermassa gekozen.",
    nietGelukt: ["Padel naast de training"],
  });
  assert.deepEqual(keuzes, {
    doel: "spiermassa",
    dagenPerWeek: 3,
    minutenPerTraining: 45,
    materiaal: ["dumbbell"],
    blessures: ["schouder"],
    focus: ["glutes", "lats", "chest"],
    doelgewicht: 72.5,
  });
  assert.equal(uitleg, "Ik heb spiermassa gekozen.");
  assert.deepEqual(nietGelukt, ["Padel naast de training"]);
});

test("wens: null betekent niet genoemd, dan blijft het formulier zoals het is", () => {
  const { keuzes } = normaliseerWens({ doel: null, ervaring: null, dagenPerWeek: 9, minutenPerTraining: null, materiaal: null, blessures: [], focus: null, doelgewicht: 900, uitleg: "", nietGelukt: [] });
  // 9 dagen bestaat niet: de dichtstbijzijnde knop is 6.
  assert.deepEqual(keuzes, { dagenPerWeek: 6, blessures: [] });
});

test("wens: rommel of geen object geeft niets ingevuld", () => {
  assert.deepEqual(normaliseerWens("hallo"), { keuzes: {}, uitleg: "", nietGelukt: [] });
  assert.deepEqual(normaliseerWens({ doel: 3, focus: "glutes", nietGelukt: "x" }).keuzes, {});
});
