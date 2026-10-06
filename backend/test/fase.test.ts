import { test } from "node:test";
import assert from "node:assert/strict";
import { bepaalFase, doelInFase, programmaWeek, type FaseInstellingen } from "../src/fase.js";

const programma: FaseInstellingen = {
  startdatum: "2026-10-06",
  introWeken: 2,
  introSets: 2,
  introRir: 3,
  deloadElkeWeken: 8,
  deloadSetFactor: 0.5,
  deloadTot: null,
};

test("week 1 begint op de startdatum", () => {
  assert.equal(programmaWeek("2026-10-06", "2026-10-06"), 1);
  assert.equal(programmaWeek("2026-10-06", "2026-10-12"), 1);
  assert.equal(programmaWeek("2026-10-06", "2026-10-13"), 2);
  assert.equal(programmaWeek("2026-10-06", "2026-10-01"), 1); // vóór de start: week 1
});

test("de eerste twee weken: introfase", () => {
  assert.equal(bepaalFase(programma, "2026-10-06").fase, "intro");
  assert.equal(bepaalFase(programma, "2026-10-19").fase, "intro");
  assert.equal(bepaalFase(programma, "2026-10-20").fase, "normaal");
});

test("elke achtste week: deload", () => {
  // Week 8 begint 7 × 7 = 49 dagen na de start.
  assert.deepEqual(bepaalFase(programma, "2026-11-24"), { fase: "deload", week: 8, handmatig: false });
  assert.equal(bepaalFase(programma, "2026-12-01").fase, "normaal");
  assert.equal(bepaalFase(programma, "2027-01-19").fase, "deload"); // week 16
});

test("handmatige deload tot en met een dag", () => {
  const p = { ...programma, deloadTot: "2026-10-28" };
  assert.deepEqual(bepaalFase(p, "2026-10-28"), { fase: "deload", week: 4, handmatig: true });
  assert.equal(bepaalFase(p, "2026-10-29").fase, "normaal");
});

test("doel in de introfase: 2 sets, RIR 3", () => {
  assert.deepEqual(doelInFase({ aantalSets: 4, minSets: 4, doelRir: 2 }, "intro", programma), {
    aantalSets: 2,
    minSets: 2,
    doelRir: 3,
  });
});

test("doel in de deload: sets gehalveerd en naar boven afgerond", () => {
  assert.equal(doelInFase({ aantalSets: 4, minSets: 4, doelRir: 2 }, "deload", programma).aantalSets, 2);
  assert.equal(doelInFase({ aantalSets: 3, minSets: 2, doelRir: 1 }, "deload", programma).aantalSets, 2);
  assert.equal(doelInFase({ aantalSets: 2, minSets: 2, doelRir: 1 }, "deload", programma).aantalSets, 1);
});

test("normaal: doel ongewijzigd", () => {
  const regel = { aantalSets: 3, minSets: 3, doelRir: 2 };
  assert.deepEqual(doelInFase(regel, "normaal", programma), regel);
});
