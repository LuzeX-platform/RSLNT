import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  aanbevolenTempo,
  bmi,
  bmiCategorie,
  bmrKatch,
  bmrMifflin,
  calorieDoel,
  dagverbruik,
  eiwitDoel,
  ffmi,
  leeftijd,
  tailleLengte,
  tempoAdvies,
  tijdlijn,
  trendKgPerWeek,
  vetNavy,
  vetvrijeMassa,
} from "../src/lichaam.js";
import { verschuifDag } from "../src/datum.js";

describe("lengte en gewicht", () => {
  test("BMI: 81 kg bij 2 meter", () => {
    assert.equal(bmi(81, 200), 20.3);
    assert.equal(bmi(90, 200), 22.5);
    assert.equal(bmiCategorie(20.3), "gezond gewicht");
    assert.equal(bmiCategorie(17), "ondergewicht");
    assert.equal(bmiCategorie(31), "obesitas");
  });

  test("taille/lengte: onder 0,5 is gezond", () => {
    assert.deepEqual(tailleLengte(90, 200), { ratio: 0.45, oordeel: "gezond" });
    assert.equal(tailleLengte(110, 200).oordeel, "verhoogd");
    assert.equal(tailleLengte(125, 200).oordeel, "hoog");
  });
});

describe("vetpercentage en FFMI", () => {
  test("US Navy, man (taille en nek)", () => {
    assert.equal(vetNavy({ geslacht: "man", lengteCm: 200, tailleCm: 85, nekCm: 39 }), 12.3);
  });

  test("US Navy, vrouw (taille, heup en nek)", () => {
    assert.equal(vetNavy({ geslacht: "vrouw", lengteCm: 170, tailleCm: 80, heupCm: 100, nekCm: 34 }), 30.1);
  });

  test("onmogelijke maten: geen schatting", () => {
    assert.equal(vetNavy({ geslacht: "man", lengteCm: 200, tailleCm: 38, nekCm: 39 }), null);
    assert.equal(vetNavy({ geslacht: "vrouw", lengteCm: 170, tailleCm: 80, nekCm: 34 }), null);
  });

  test("FFMI en de lengtecorrectie van Kouri: lange mensen komen lager uit", () => {
    const vvm = vetvrijeMassa(81, 12.3);
    assert.equal(vvm, 71);
    assert.deepEqual(ffmi(vvm, 200), { ffmi: 17.8, genormaliseerd: 16.5 });
    assert.deepEqual(ffmi(vvm, 180), { ffmi: 21.9, genormaliseerd: 21.9 });
  });
});

describe("energie", () => {
  test("leeftijd: pas ouder op je verjaardag", () => {
    assert.equal(leeftijd("1995-10-07", "2026-10-06"), 30);
    assert.equal(leeftijd("1995-10-06", "2026-10-06"), 31);
  });

  test("Mifflin-St Jeor en Katch-McArdle", () => {
    assert.equal(bmrMifflin({ kg: 81, lengteCm: 200, leeftijd: 30, geslacht: "man" }), 1915);
    assert.equal(bmrMifflin({ kg: 60, lengteCm: 165, leeftijd: 30, geslacht: "vrouw" }), 1320);
    assert.equal(bmrKatch(71), 1904);
  });

  test("dagverbruik, calorie- en eiwitdoel", () => {
    const onderhoud = dagverbruik(1915, "licht");
    assert.equal(onderhoud, 2633);
    assert.deepEqual(calorieDoel(onderhoud), { onderhoud: 2633, start: 2900, min: 2760, max: 3030 });
    assert.deepEqual(eiwitDoel(81), { min: 130, max: 178 });
  });
});

describe("tempo en doel", () => {
  const reeks = (dagen: number, perDag: number) =>
    Array.from({ length: dagen / 2 }, (_, i) => ({ datum: verschuifDag("2026-09-09", i * 2), gewicht: 81 + i * 2 * perDag }));

  test("trend: helling door alle wegingen, in kg per week", () => {
    assert.equal(trendKgPerWeek(reeks(28, 0.05), "2026-10-06"), 0.35);
  });

  test("trend: te weinig wegingen of te kort → onbekend", () => {
    assert.equal(trendKgPerWeek(reeks(4, 0.05), "2026-10-06"), null);
    const kort = [0, 1, 2, 3].map((i) => ({ datum: verschuifDag("2026-10-01", i), gewicht: 81 }));
    assert.equal(trendKgPerWeek(kort, "2026-10-06"), null);
  });

  test("tempo-advies bij je doeltempo", () => {
    assert.equal(tempoAdvies(0.1, 0.25, 0.5).oordeel, "te_langzaam");
    assert.equal(tempoAdvies(0.35, 0.25, 0.5).oordeel, "op_koers");
    assert.equal(tempoAdvies(0.8, 0.25, 0.5).oordeel, "te_snel");
    assert.equal(tempoAdvies(null, 0.25, 0.5).oordeel, "onbekend");
  });

  test("tijdlijn naar het doelgewicht", () => {
    assert.deepEqual(tijdlijn(81.4, 90, 0.25, 0.5, "2026-10-06"), {
      nogKg: 8.6,
      wekenMin: 18,
      wekenMax: 35,
      vroegst: "2027-02-09",
      uiterlijk: "2027-06-08",
    });
    assert.equal(tijdlijn(90, 90, 0.25, 0.5, "2026-10-06"), null);
  });

  test("aanbevolen tempo: 0,25–0,5% van je gewicht per week", () => {
    assert.deepEqual(aanbevolenTempo(81), { min: 0.2, max: 0.41 });
  });
});
