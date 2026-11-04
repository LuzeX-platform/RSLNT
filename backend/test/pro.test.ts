// Unittests voor de rekenregels achter Pro (en de gratis opwarmsets en schijvencalculator).
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { opwarmsets } from "../src/opwarmen.js";
import { krachtNiveau, krachtTrend, repRecords, richtgewicht, richtgewichten, volumePerWeek, volumeZone } from "../src/analyse.js";
import { bijsturing } from "../src/autoregulatie.js";
import { blokOp, doelInBlok, eindeVan, SJABLONEN, totaalWeken, type Blokplan } from "../src/periodisering.js";
import { adviesVoorVandaag } from "../src/belasting.js";
import { hybrideAdvies, isZwaar } from "../src/hybride.js";
import { pijnOverzicht } from "../src/pijnlogboek.js";
import { bepaalVoorstel, type EerdereSessie } from "../src/progressie.js";
import { doelInFase } from "../src/fase.js";

const require = createRequire(import.meta.url);
const { schijvenPerKant, schijvenTekst } = require("../../frontend/schijven.js");

const set = (gewicht: number | null, reps: number, rir: number | null = 2, pijn: number | null = null, soort?: string) => ({
  gewicht,
  reps,
  rir,
  pijn,
  pijnPlek: null,
  ...(soort ? { soort } : {}),
});

describe("opwarmsets (gratis)", () => {
  test("stang: lege stang, dan 40/60/80%, afgerond op de stap", () => {
    assert.deepEqual(opwarmsets(100, 2.5, "barbell"), [
      { gewicht: 20, reps: 10, procent: 20 },
      { gewicht: 40, reps: 8, procent: 40 },
      { gewicht: 60, reps: 5, procent: 60 },
      { gewicht: 80, reps: 3, procent: 80 },
    ]);
  });
  test("licht werkgewicht: minder opwarmsets, nooit zwaarder dan je werkset", () => {
    assert.deepEqual(opwarmsets(16, 2, "dumbbell"), [{ gewicht: 8, reps: 8, procent: 50 }]);
    assert.deepEqual(opwarmsets(40, 2, "dumbbell").map((s) => s.gewicht), [20, 30]);
    for (const s of opwarmsets(62.5, 2.5, "barbell")) assert.ok(s.gewicht < 62.5);
  });
  test("zonder gewicht of zonder stap: geen opwarmsets", () => {
    assert.deepEqual(opwarmsets(null, 2.5, "barbell"), []);
    assert.deepEqual(opwarmsets(20, 0, "lichaamsgewicht"), []);
  });
  test("geen dubbele gewichten, ook niet als de stang het minimum is", () => {
    const sets = opwarmsets(45, 2.5, "barbell");
    assert.equal(new Set(sets.map((s) => s.gewicht)).size, sets.length);
    assert.equal(sets[0].gewicht, 20);
  });
});

describe("schijvencalculator (gratis)", () => {
  test("zwaarste schijven eerst, per kant", () => {
    assert.deepEqual(schijvenPerKant(100), { perKant: [25, 15], rest: 0 });
    assert.deepEqual(schijvenPerKant(62.5), { perKant: [20, 1.25], rest: 0 });
    assert.deepEqual(schijvenPerKant(20), { perKant: [], rest: 0 });
  });
  test("lichter dan de stang of niet precies te maken", () => {
    assert.equal(schijvenPerKant(15), null);
    assert.deepEqual(schijvenPerKant(21), { perKant: [], rest: 1 });
    assert.equal(schijvenTekst(102.5), "25 + 15 + 1,25 per kant");
    assert.equal(schijvenTekst(20), "alleen de stang");
    assert.match(schijvenTekst(10), /lichter dan de stang/);
  });
  test("andere stang", () => {
    assert.deepEqual(schijvenPerKant(35, 15), { perKant: [10], rest: 0 });
  });
});

describe("krachttrend", () => {
  const punten = [
    { datum: "2026-09-14", e1rm: 100 },
    { datum: "2026-09-21", e1rm: 102 },
    { datum: "2026-09-28", e1rm: 104 },
    { datum: "2026-10-05", e1rm: 106 },
  ];
  test("2 kg per week, met een voorspelling vanaf 4 punten", () => {
    const t = krachtTrend(punten, "2026-10-05")!;
    assert.equal(t.kgPerWeek, 2);
    assert.equal(t.nu, 106);
    assert.equal(t.over4Weken, 114);
    assert.equal(t.over8Weken, 122);
  });
  test("te weinig of te dicht op elkaar: geen lijn", () => {
    assert.equal(krachtTrend(punten.slice(0, 2), "2026-10-05"), null);
    assert.equal(
      krachtTrend([{ datum: "2026-10-01", e1rm: 1 }, { datum: "2026-10-03", e1rm: 2 }, { datum: "2026-10-05", e1rm: 3 }], "2026-10-05"),
      null,
    );
  });
  test("drie punten: wel een tempo, geen voorspelling; ouder dan 8 weken telt niet", () => {
    const t = krachtTrend([{ datum: "2026-01-01", e1rm: 50 }, ...punten.slice(1)], "2026-10-05")!;
    assert.equal(t.punten, 3);
    assert.equal(t.over4Weken, null);
  });
});

describe("records en richtgewichten", () => {
  test("zwaarste set per aantal reps, eerste keer telt bij gelijk", () => {
    const r = repRecords([
      { gewicht: 80, reps: 5, datum: "2026-10-01" },
      { gewicht: 85, reps: 5, datum: "2026-10-08" },
      { gewicht: 85, reps: 5, datum: "2026-10-15" },
      { gewicht: 70, reps: 10, datum: "2026-10-01" },
      { gewicht: null, reps: 12, datum: "2026-10-01" },
      { gewicht: 50, reps: 20, datum: "2026-10-01" },
    ]);
    assert.deepEqual(r, [
      { reps: 5, gewicht: 85, datum: "2026-10-08" },
      { reps: 10, gewicht: 70, datum: "2026-10-01" },
    ]);
  });
  test("Epley omgekeerd, naar beneden op de stap", () => {
    // 100 / (1 + 7/30) = 81,08 → 80
    assert.equal(richtgewicht(100, 5, 2, 2.5), 80);
    assert.equal(richtgewichten(100, 2.5).length, 6);
    const lijst = richtgewichten(100, 2.5);
    for (let i = 1; i < lijst.length; i++) assert.ok(lijst[i].gewicht <= lijst[i - 1].gewicht);
  });
});

describe("volume in zones", () => {
  test("grenzen 4, 10 en 20", () => {
    assert.equal(volumeZone(3.5), "laag");
    assert.equal(volumeZone(4), "matig");
    assert.equal(volumeZone(10), "productief");
    assert.equal(volumeZone(20.5), "hoog");
  });
  test("gemiddelde vanaf je eerste trainingsweek, richting na 8 weken", () => {
    const blokken = [{}, {}, { chest: 6 }, { chest: 6 }, { chest: 6 }, { chest: 6 }, { chest: 12 }, { chest: 12 }, { chest: 12 }, { chest: 12 }];
    const [borst] = volumePerWeek(blokken, 2);
    assert.equal(borst.gemiddeld, 9);
    assert.equal(borst.zone, "matig");
    assert.equal(borst.richting, "op");
    assert.equal(borst.weken.length, 10);
  });
});

describe("krachtniveau", () => {
  test("verhouding tot lichaamsgewicht, met het volgende niveau", () => {
    const n = krachtNiveau("back_squat", 120, 80, "man")!;
    assert.equal(n.verhouding, 1.5);
    assert.equal(n.niveau, "gemiddeld");
    assert.deepEqual(n.volgende, { niveau: "gevorderd", e1rm: 140 });
    assert.equal(krachtNiveau("bench_press", 200, 80, "man")!.volgende, null);
    assert.equal(krachtNiveau("bench_press", 20, 80, "vrouw")!.niveau, "beginner");
  });
  test("zonder gewicht, geslacht of norm: niets", () => {
    assert.equal(krachtNiveau("back_squat", 120, null, "man"), null);
    assert.equal(krachtNiveau("back_squat", 120, 80, null), null);
    assert.equal(krachtNiveau("leg_press", 120, 80, "man"), null);
  });
});

describe("bijsturen per set (autoregulatie)", () => {
  const stang = { gewichtsstap: 2.5 };
  const doel = { repsMin: 6, repsMax: 8, doelRir: 2, aantalSets: 3 };
  test("makkelijker dan bedoeld op de bovenkant: één stap omhoog", () => {
    assert.deepEqual(bijsturing(stang, doel, [set(80, 8, 4)])?.gewicht, 82.5);
  });
  test("zwaarder dan bedoeld of onder de range: omlaag, minstens 5%", () => {
    const b = bijsturing(stang, doel, [set(80, 7, 0)])!;
    assert.equal(b.actie, "omlaag");
    assert.equal(b.gewicht, 75);
    assert.equal(bijsturing(stang, doel, [set(80, 5, 1)])!.actie, "omlaag");
  });
  test("precies goed: gelijk; zonder RIR of na de laatste set: niets", () => {
    assert.equal(bijsturing(stang, doel, [set(80, 7, 2)])!.actie, "gelijk");
    assert.equal(bijsturing(stang, doel, [set(80, 7, null)]), null);
    assert.equal(bijsturing(stang, doel, [set(80, 8, 4), set(80, 8, 4), set(80, 8, 4)]), null);
    assert.equal(bijsturing({ gewichtsstap: 0 }, doel, [set(null, 8, 4)]), null);
  });
  test("pijn 4 of meer gaat voor alles: 10% lichter", () => {
    const b = bijsturing(stang, doel, [set(80, 8, 4, 5)])!;
    assert.equal(b.actie, "pijn");
    assert.equal(b.gewicht, 70, "80 × 0,9 = 72, omlaag op 2,5");
  });
});

describe("periodisering in blokken", () => {
  const plan: Blokplan = { doel: "kracht", start: "2026-11-02", blokken: SJABLONEN.kracht.blokken };
  test("blok en week op een dag; buiten het plan niets", () => {
    assert.equal(totaalWeken(plan), 9);
    assert.equal(eindeVan(plan), "2027-01-03");
    assert.equal(blokOp(plan, "2026-11-01"), null);
    assert.deepEqual(
      (({ soort, weekInBlok, week }) => ({ soort, weekInBlok, week }))(blokOp(plan, "2026-11-02")!),
      { soort: "opbouw", weekInBlok: 1, week: 1 },
    );
    assert.equal(blokOp(plan, "2026-11-23")!.soort, "intensivering");
    assert.equal(blokOp(plan, "2026-12-14")!.soort, "piek");
    assert.equal(blokOp(plan, "2027-01-03")!.soort, "deload");
    assert.equal(blokOp(plan, "2027-01-04"), null);
  });
  const regel = { aantalSets: 3, minSets: 2, repsMin: 8, repsMax: 12, doelRir: 2 };
  test("per blok een ander doel; isolatie blijft bij intensiveren gelijk", () => {
    assert.equal(doelInBlok(regel, "opbouw", true).doelRir, 3);
    assert.equal(doelInBlok(regel, "volume", true).aantalSets, 4);
    assert.deepEqual(doelInBlok(regel, "intensivering", true), { aantalSets: 3, minSets: 2, repsMin: 5, repsMax: 8, doelRir: 1 });
    assert.deepEqual(doelInBlok(regel, "intensivering", false), regel);
    assert.deepEqual(doelInBlok(regel, "piek", true), { aantalSets: 2, minSets: 2, repsMin: 2, repsMax: 4, doelRir: 1 });
    assert.equal(doelInBlok({ ...regel, aantalSets: 1, minSets: 1 }, "piek", false).aantalSets, 1);
  });
  test("elke combinatie geeft een geldige range", () => {
    for (const soort of ["opbouw", "volume", "intensivering", "piek", "deload"] as const) {
      for (const repsMin of [1, 3, 6, 8, 15]) {
        for (const extra of [0, 2, 5]) {
          for (const basis of [true, false]) {
            const d = doelInBlok({ aantalSets: 3, minSets: 3, repsMin, repsMax: repsMin + extra, doelRir: null }, soort, basis);
            assert.ok(d.repsMin <= d.repsMax && d.repsMin >= 1, `${soort} ${repsMin}+${extra}`);
            assert.ok(d.minSets <= d.aantalSets && d.aantalSets >= 1);
          }
        }
      }
    }
  });
});

describe("lichte dag", () => {
  test("één set minder en een rep meer over", () => {
    const p = { startdatum: "2026-01-01", introWeken: 0, introSets: null, introRir: null, deloadElkeWeken: null, deloadSetFactor: 0.5, deloadTot: null };
    assert.deepEqual(doelInFase({ aantalSets: 3, minSets: 3, doelRir: 2 }, "licht", p), { aantalSets: 2, minSets: 2, doelRir: 3 });
    assert.deepEqual(doelInFase({ aantalSets: 1, minSets: 1, doelRir: 4 }, "licht", p), { aantalSets: 1, minSets: 1, doelRir: 4 });
  });
});

describe("advies voor vandaag (slim herstel)", () => {
  const goed = { slaap: 4, energie: 4, spierpijn: 2, pijn: 1 };
  const slecht = { slaap: 2, energie: 2, spierpijn: 4, pijn: 1 };
  const leeg = { stagnerend: [], pijn: [], wekenSindsDeload: 2 };
  test("alles goed: gewoon trainen", () => {
    assert.equal(adviesVoorVandaag({ vandaag: goed, checks: [goed, goed], ...leeg }).advies, "normaal");
  });
  test("vandaag slecht: lichte dag; herhaald slecht en lang geen deload: deloadweek", () => {
    assert.equal(adviesVoorVandaag({ vandaag: slecht, checks: [slecht, goed, goed], ...leeg }).advies, "lichte_dag");
    assert.equal(adviesVoorVandaag({ vandaag: slecht, checks: [slecht, slecht, goed], ...leeg }).advies, "lichte_dag");
    const r = adviesVoorVandaag({ vandaag: slecht, checks: [slecht, slecht, goed], ...leeg, wekenSindsDeload: 7 });
    assert.equal(r.advies, "deload");
    assert.ok(r.redenen.some((t) => t.includes("7 weken")));
  });
  test("drie oefeningen vast: deload, ook zonder herstelcheck; pijn: lichte dag", () => {
    assert.equal(adviesVoorVandaag({ vandaag: null, checks: [], ...leeg, stagnerend: ["a", "b", "c"] }).advies, "deload");
    assert.equal(adviesVoorVandaag({ vandaag: null, checks: [], ...leeg, pijn: ["Leg press"] }).advies, "lichte_dag");
    assert.match(adviesVoorVandaag({ vandaag: null, checks: [], ...leeg }).redenen[0], /herstelcheck/);
  });
});

describe("hybride trainen", () => {
  const benen = { naam: "Benen", benenSets: 10 };
  test("harde duurtraining gisteren + benendag: melding", () => {
    const a = hybrideAdvies([{ datum: "2026-11-03", soort: "hardlopen", minuten: 40, intensiteit: "interval" }], "2026-11-04", benen);
    assert.equal(a.meldingen.length, 1);
    assert.match(a.meldingen[0], /Gisteren/);
  });
  test("rustig of voor het bovenlichaam: geen melding", () => {
    const rustig = [{ datum: "2026-11-04", soort: "fietsen", minuten: 45, intensiteit: "rustig" }];
    assert.equal(hybrideAdvies(rustig, "2026-11-04", benen).meldingen.length, 0);
    const hard = [{ datum: "2026-11-04", soort: "fietsen", minuten: 30, intensiteit: "tempo" }];
    assert.equal(hybrideAdvies(hard, "2026-11-04", { naam: "Push", benenSets: 0 }).meldingen.length, 0);
    assert.ok(isZwaar({ datum: "", soort: "fietsen", minuten: 80, intensiteit: "rustig" }));
  });
  test("weektotaal en veel hardlopen", () => {
    const lopen = [0, 1, 2, 3, 4].map((i) => ({ datum: `2026-11-0${i}`, soort: "hardlopen", minuten: 35, intensiteit: "duur" }));
    const a = hybrideAdvies(lopen, "2026-11-04", null);
    assert.equal(a.week.minuten, 175);
    assert.equal(a.week.sessies, 5);
    assert.ok(a.meldingen.some((m) => m.includes("175 minuten")));
  });
});

describe("pijnlogboek", () => {
  test("per plek per week, met oefeningen en richting", () => {
    const sets = [
      { dag: "2026-10-10", oefening: "Leg press", pijn: 5, plek: "knie" },
      { dag: "2026-10-12", oefening: "Leg extension", pijn: 4, plek: "knie" },
      { dag: "2026-11-02", oefening: "Leg press", pijn: 1, plek: "knie" },
      { dag: "2026-11-02", oefening: "Bench", pijn: 0, plek: "schouder" },
    ];
    const checks = [{ dag: "2026-11-03", pijn: 3, plekken: ["knie", "schouder"] }];
    const [knie, schouder] = pijnOverzicht(sets, checks, "2026-11-04", 4);
    assert.equal(knie.plek, "knie");
    assert.equal(knie.perWeek.length, 4);
    assert.equal(knie.oefeningen[0].naam, "Leg press");
    assert.equal(knie.oefeningen[0].keer, 2);
    assert.equal(knie.richting, "beter");
    assert.equal(knie.checkDagen, 1);
    assert.equal(schouder.oefeningen.length, 0, "pijn 0 is geen pijn");
    assert.equal(schouder.checkDagen, 1);
  });
});

describe("progressieregels (Pro)", () => {
  const stang = { materiaal: "barbell", gewichtsstap: 2.5 };
  const doel = { minSets: 3, repsMin: 5, repsMax: 8 };
  const sessie = (sets: ReturnType<typeof set>[], extra: Partial<EerdereSessie> = {}): EerdereSessie => ({ sets, doelRir: 2, ...extra });
  test("lineair: alle sets op de onderkant is al genoeg voor een stap", () => {
    const h = [sessie([set(80, 5), set(80, 5), set(80, 6)])];
    assert.equal(bepaalVoorstel(stang, doel, h).actie, "gelijk", "dubbel wacht op 8");
    const v = bepaalVoorstel(stang, doel, h, { regel: "lineair" });
    assert.equal(v.actie, "omhoog");
    assert.equal(v.gewicht, 82.5);
  });
  test("rir: omhoog als elke set één rep meer over had dan het doel, niet zonder RIR", () => {
    assert.equal(bepaalVoorstel(stang, doel, [sessie([set(80, 6, 3), set(80, 6, 3), set(80, 5, 3)])], { regel: "rir" }).actie, "omhoog");
    assert.equal(bepaalVoorstel(stang, doel, [sessie([set(80, 6, 3), set(80, 6, 2), set(80, 5, 3)])], { regel: "rir" }).actie, "gelijk");
    assert.match(bepaalVoorstel(stang, doel, [sessie([set(80, 6, null), set(80, 6, 3), set(80, 5, 3)])], { regel: "rir" }).reden, /RIR/);
  });
  test("vast: geen stagnatieregel, wel de pijnregel", () => {
    const onder = [sessie([set(80, 3), set(80, 3), set(80, 3)]), sessie([set(80, 3), set(80, 3), set(80, 3)])];
    assert.equal(bepaalVoorstel(stang, doel, onder).actie, "terug");
    assert.equal(bepaalVoorstel(stang, doel, onder, { regel: "vast" }).actie, "gelijk");
    const pijn = [sessie([set(80, 8, 2, 6), set(80, 8), set(80, 8)])];
    assert.equal(bepaalVoorstel(stang, doel, pijn, { regel: "vast" }).pijnRegel, true);
  });
  test("max. één stap blijft voor elke regel", () => {
    for (const regel of ["dubbel", "lineair", "rir"] as const) {
      const v = bepaalVoorstel(stang, doel, [sessie([set(80, 15, 4), set(80, 15, 4), set(80, 15, 4)])], { regel });
      assert.equal(v.gewicht, 82.5, regel);
    }
  });
  test("technieksets tellen niet voor progressie, wel voor pijn", () => {
    const h = [sessie([set(80, 8), set(80, 8), set(80, 8), set(60, 6, 0, null, "drop")])];
    const v = bepaalVoorstel(stang, doel, h);
    assert.equal(v.actie, "omhoog", "de dropset met 6 reps houdt de stap niet tegen");
    assert.equal(v.gewicht, 82.5, "werkgewicht is 80, niet de 60 van de dropset");
    const metPijn = [sessie([set(80, 8), set(80, 8), set(80, 8), set(60, 6, 0, 6, "drop")])];
    assert.equal(bepaalVoorstel(stang, doel, metPijn).pijnRegel, true);
  });
});
