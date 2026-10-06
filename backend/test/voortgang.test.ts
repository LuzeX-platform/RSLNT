import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { besteE1rm, e1rm, fractioneleSets, teVolPerTraining, weekStart } from "../src/voortgang.js";
import { herstelSignalen, deloadOverwegen, status } from "../src/herstel.js";

test("e1RM volgens Epley, met RIR erbij", () => {
  assert.equal(e1rm(100, 8, 2), 133.3);
  assert.equal(e1rm(100, 8, null), 126.7); // zonder RIR: alsof tot falen
  assert.equal(e1rm(100, 18, 4), null); // boven 20 onbetrouwbaar
  assert.equal(e1rm(null, 10, 2), null);
  assert.equal(besteE1rm([{ gewicht: 80, reps: 8, rir: 3 }, { gewicht: 85, reps: 6, rir: 2 }]), 109.3); // 80 × (1 + 11/30) wint van 85 × (1 + 8/30)
});

test("week begint op maandag", () => {
  assert.equal(weekStart("2026-10-05"), "2026-10-05");
  assert.equal(weekStart("2026-10-06"), "2026-10-05");
  assert.equal(weekStart("2026-10-11"), "2026-10-05");
  assert.equal(weekStart("2026-10-12"), "2026-10-12");
});

test("fractionele sets: hoofdspier 1, hulpspier ½", () => {
  const sets = fractioneleSets([
    { spierenPrimair: ["quads", "glutes"], spierenSecundair: ["hamstrings", "upper_back", "forearms"], sets: 4 },
    { spierenPrimair: ["hamstrings", "glutes"], spierenSecundair: ["lower_back", "forearms"], sets: 3 },
  ]);
  assert.deepEqual(sets, { quads: 4, glutes: 7, hamstrings: 5, upper_back: 2, forearms: 3.5, lower_back: 1.5 });
});

test("benendag uit je programma: 13 sets voorkant bovenbeen, boven de grens van 11", () => {
  const p = JSON.parse(readFileSync(new URL("../programmas/benen-push-pull.json", import.meta.url), "utf8"));
  const oefeningen = new Map(p.exercises.map((e: any) => [e.id, e]));
  const benen = p.workouts.find((w: any) => w.id === "A").exercises.map((r: any) => {
    const e: any = oefeningen.get(r.exercise_id);
    return { spierenPrimair: e.muscles_primary, spierenSecundair: e.muscles_secondary, sets: r.sets };
  });
  assert.deepEqual(teVolPerTraining(benen)[0], { spier: "quads", sets: 13 });
});

test("herstel: vier losse signalen, met je eigen gemiddelde", () => {
  assert.equal(status("slaap", 5), "goed");
  assert.equal(status("slaap", 3), "neutraal");
  assert.equal(status("slaap", 2), "let_op");
  assert.equal(status("kniepijn", 1), "goed");
  assert.equal(status("kniepijn", 4), "let_op");

  const eerder = [
    { slaap: 4, energie: 4, spierpijn: 2, kniepijn: 1 },
    { slaap: 3, energie: 4, spierpijn: 2, kniepijn: 1 },
    { slaap: 5, energie: 3, spierpijn: 3, kniepijn: 2 },
  ];
  const signalen = herstelSignalen({ slaap: 2, energie: 4, spierpijn: 2, kniepijn: 3 }, eerder);
  assert.deepEqual(signalen.map((s) => [s.item, s.status, s.gemiddelde]), [
    ["slaap", "let_op", 4],
    ["energie", "goed", 3.7],
    ["spierpijn", "goed", 2.3],
    ["kniepijn", "neutraal", 1.3],
  ]);
  assert.equal(herstelSignalen({ slaap: 2, energie: 4, spierpijn: 2, kniepijn: 3 }, eerder.slice(0, 2))[0].gemiddelde, null);
});

test("herstel: deload overwegen na herhaald slecht herstel", () => {
  const slecht = { slaap: 2, energie: 2, spierpijn: 3, kniepijn: 1 };
  const goed = { slaap: 4, energie: 4, spierpijn: 2, kniepijn: 1 };
  assert.equal(deloadOverwegen([slecht, goed, slecht]), true);
  assert.equal(deloadOverwegen([slecht, goed, goed]), false);
  assert.equal(deloadOverwegen([goed, goed, goed, slecht, slecht]), false); // alleen de laatste drie
});
