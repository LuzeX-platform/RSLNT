import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  bepaalVoorstel,
  kniepijnSignaal,
  rondOmlaag,
  werkgewicht,
  type EerdereSessie,
  type GelogdeSet,
} from "../src/progressie.js";

const dumbbell = { materiaal: "dumbbell", gewichtsstap: 2, knieGevoelig: false };
const gobletSquat = { materiaal: "dumbbell", gewichtsstap: 2, knieGevoelig: true };
const trapBar = { materiaal: "trap_bar", gewichtsstap: 2.5, knieGevoelig: true };
const deadBug = { materiaal: "lichaamsgewicht", gewichtsstap: 0, knieGevoelig: false };
const doel = { minSets: 3, repsMin: 8, repsMax: 10 };

/** Korte notatie: sessie(20, [10, 10, 9], [0, 1, null]) = drie sets met 20 kg. */
function sessie(gewicht: number | null, reps: number[], kniepijn: (number | null)[] = []): EerdereSessie {
  return {
    sets: reps.map(
      (r, i): GelogdeSet => ({ gewicht, reps: r, rir: 2, kniepijn: kniepijn[i] ?? null }),
    ),
  };
}

describe("dubbele progressie", () => {
  test("geen eerdere sessie: geen voorstel", () => {
    const v = bepaalVoorstel(dumbbell, doel, []);
    assert.equal(v.actie, "eerste_keer");
    assert.equal(v.gewicht, null);
  });

  test("sessies zonder sets tellen niet als eerdere keer", () => {
    assert.equal(bepaalVoorstel(dumbbell, doel, [{ sets: [] }]).actie, "eerste_keer");
  });

  test("alle sets op de bovenkant: één kleinste stap omhoog", () => {
    const v = bepaalVoorstel(dumbbell, doel, [sessie(20, [10, 10, 10])]);
    assert.equal(v.actie, "omhoog");
    assert.equal(v.gewicht, 22);
    assert.equal(v.kniepijnRegel, false);
  });

  test("één set onder de bovenkant: zelfde gewicht", () => {
    const v = bepaalVoorstel(dumbbell, doel, [sessie(20, [10, 10, 9])]);
    assert.equal(v.actie, "gelijk");
    assert.equal(v.gewicht, 20);
    assert.match(v.reden, /10\/10\/9/);
  });

  test("nooit meer dan één stap omhoog, hoe ver je ook boven de range zat", () => {
    const v = bepaalVoorstel(trapBar, { minSets: 3, repsMin: 6, repsMax: 8 }, [sessie(100, [15, 14, 14])]);
    assert.equal(v.gewicht, 102.5);
  });

  test("te weinig sets gelogd: niet omhoog, ook al zaten ze op de bovenkant", () => {
    const v = bepaalVoorstel(dumbbell, doel, [sessie(20, [10, 10])]);
    assert.equal(v.actie, "gelijk");
    assert.match(v.reden, /2 van minimaal 3 sets/);
  });

  test("superset met 2–3 sets: 2 sets op de bovenkant is genoeg", () => {
    const v = bepaalVoorstel(dumbbell, { minSets: 2, repsMin: 10, repsMax: 12 }, [sessie(12, [12, 12])]);
    assert.equal(v.actie, "omhoog");
    assert.equal(v.gewicht, 14);
  });

  test("extra set onder de bovenkant telt mee: niet omhoog", () => {
    const v = bepaalVoorstel(dumbbell, doel, [sessie(20, [10, 10, 10, 7])]);
    assert.equal(v.actie, "gelijk");
  });

  test("wisselende gewichten: het laagste is het werkgewicht", () => {
    const s: EerdereSessie = {
      sets: [
        { gewicht: 22, reps: 10, rir: 1, kniepijn: null },
        { gewicht: 20, reps: 10, rir: 1, kniepijn: null },
        { gewicht: 20, reps: 10, rir: 0, kniepijn: null },
      ],
    };
    assert.equal(werkgewicht(s), 20);
    assert.equal(bepaalVoorstel(dumbbell, doel, [s]).gewicht, 22);
  });

  test("het doel van nu telt, niet dat van vorige keer", () => {
    // Vorige keer 8 reps; de range is inmiddels 6–8 geworden → omhoog.
    const v = bepaalVoorstel(dumbbell, { minSets: 3, repsMin: 6, repsMax: 8 }, [sessie(20, [8, 8, 8])]);
    assert.equal(v.actie, "omhoog");
  });

  test("alleen de laatste sessie bepaalt progressie", () => {
    const v = bepaalVoorstel(dumbbell, doel, [sessie(22, [9, 8, 8]), sessie(20, [10, 10, 10])]);
    assert.equal(v.actie, "gelijk");
    assert.equal(v.gewicht, 22);
  });

  test("decimale stappen blijven netjes", () => {
    const v = bepaalVoorstel({ materiaal: "kabel", gewichtsstap: 2.5, knieGevoelig: false }, doel, [sessie(37.5, [10, 10, 10])]);
    assert.equal(v.gewicht, 40);
  });
});

describe("kniepijnregel", () => {
  test("kniepijn 4 of hoger: 10% terug, afgerond op de stap", () => {
    const v = bepaalVoorstel(trapBar, doel, [sessie(100, [8, 8, 8], [2, 4, 3])]);
    assert.equal(v.actie, "terug");
    assert.equal(v.gewicht, 90);
    assert.equal(v.kniepijnRegel, true);
    assert.match(v.reden, /Kniepijn 4\/10/);
  });

  test("gaat vóór progressie: ook bij alle sets op de bovenkant", () => {
    const v = bepaalVoorstel(trapBar, doel, [sessie(100, [10, 10, 10], [5])]);
    assert.equal(v.actie, "terug");
  });

  test("10% is minder dan één stap: toch minimaal één stap terug", () => {
    // 10% van 12 kg = 1,2 kg; de kleinste stap is 2 kg.
    const v = bepaalVoorstel(gobletSquat, doel, [sessie(12, [8, 8, 8], [6])]);
    assert.equal(v.gewicht, 10);
  });

  test("afronden naar beneden op wat er in het rek ligt", () => {
    // 22 kg × 0,9 = 19,8 → 18 kg bij stappen van 2 kg.
    assert.equal(bepaalVoorstel(gobletSquat, doel, [sessie(22, [8, 8, 8], [4])]).gewicht, 18);
  });

  test("nooit onder nul", () => {
    assert.equal(bepaalVoorstel(gobletSquat, doel, [sessie(2, [8, 8, 8], [7])]).gewicht, 0);
  });

  test("stijging van 2 punten t.o.v. de keer ervoor", () => {
    assert.match(kniepijnSignaal([sessie(20, [8], [3]), sessie(20, [8], [1])]) ?? "", /steeg van 1 naar 3/);
  });

  test("stijging van 1 punt is nog geen signaal", () => {
    assert.equal(kniepijnSignaal([sessie(20, [8], [2]), sessie(20, [8], [1])]), null);
  });

  test("drie sessies op rij hoger", () => {
    const signaal = kniepijnSignaal([sessie(20, [8], [3]), sessie(20, [8], [2]), sessie(20, [8], [1])]);
    assert.match(signaal ?? "", /drie trainingen op rij \(1 → 2 → 3\)/);
  });

  test("gelijk gebleven of gedaald: geen signaal", () => {
    assert.equal(kniepijnSignaal([sessie(20, [8], [2]), sessie(20, [8], [2]), sessie(20, [8], [1])]), null);
    assert.equal(kniepijnSignaal([sessie(20, [8], [1]), sessie(20, [8], [3])]), null);
  });

  test("niet ingevuld is onbekend, niet 0", () => {
    // Vorige keer niets ingevuld: geen signaal, ook al was het daarvoor 3.
    assert.equal(kniepijnSignaal([sessie(20, [8]), sessie(20, [8], [3])]), null);
    // De keer ervoor niets ingevuld: 3 is dan geen "stijging van 0 naar 3".
    assert.equal(kniepijnSignaal([sessie(20, [8], [3]), sessie(20, [8])]), null);
  });

  test("de hoogste waarde van de sessie telt", () => {
    assert.match(kniepijnSignaal([sessie(20, [8, 8, 8], [0, 1, 4])]) ?? "", /4\/10/);
  });

  test("lichaamsgewicht met kniepijn: terug zonder gewicht", () => {
    const v = bepaalVoorstel({ ...deadBug, knieGevoelig: true }, doel, [sessie(null, [10, 10, 10], [5])]);
    assert.equal(v.actie, "terug");
    assert.equal(v.gewicht, null);
  });
});

describe("lichaamsgewicht", () => {
  test("bovenkant gehaald: moeilijkere variant", () => {
    const v = bepaalVoorstel(deadBug, doel, [sessie(null, [10, 10, 10])]);
    assert.equal(v.actie, "moeilijker");
    assert.equal(v.gewicht, null);
  });

  test("bovenkant niet gehaald: zelfde variant", () => {
    const v = bepaalVoorstel(deadBug, doel, [sessie(null, [10, 9, 8])]);
    assert.equal(v.actie, "gelijk");
    assert.equal(v.gewicht, null);
  });
});

test("rondOmlaag", () => {
  assert.equal(rondOmlaag(19.8, 2), 18);
  assert.equal(rondOmlaag(20, 2), 20);
  assert.equal(rondOmlaag(90, 2.5), 90);
  assert.equal(rondOmlaag(33.75, 2.5), 32.5);
  assert.equal(rondOmlaag(0.3 * 3, 0.3), 0.9);
});

describe("kniepijnregel alleen bij knie-gevoelige oefeningen", () => {
  test("bench press met kniepijn: gewoon dubbele progressie", () => {
    const v = bepaalVoorstel(dumbbell, doel, [sessie(24, [10, 10, 10], [6])]);
    assert.equal(v.actie, "omhoog");
    assert.equal(v.kniepijnRegel, false);
  });
});

describe("doel-RIR", () => {
  const metRir = (rirs: (number | null)[], doelRir: number | null): EerdereSessie => ({
    doelRir,
    sets: rirs.map((rir) => ({ gewicht: 20, reps: 10, rir, kniepijn: null })),
  });

  test("bovenkant gehaald mét genoeg reps over: omhoog", () => {
    assert.equal(bepaalVoorstel(dumbbell, doel, [metRir([2, 2, 3], 2)]).actie, "omhoog");
  });

  test("bovenkant gehaald, maar dichter bij falen dan het doel: zelfde gewicht", () => {
    const v = bepaalVoorstel(dumbbell, doel, [metRir([2, 1, 0], 2)]);
    assert.equal(v.actie, "gelijk");
    assert.equal(v.gewicht, 20);
    assert.match(v.reden, /minder dan 2 reps over/);
  });

  test("RIR niet ingevuld telt als gehaald", () => {
    assert.equal(bepaalVoorstel(dumbbell, doel, [metRir([null, null, 2], 2)]).actie, "omhoog");
  });

  test("geen doel-RIR: alleen de reps tellen", () => {
    assert.equal(bepaalVoorstel(dumbbell, doel, [metRir([0, 0, 0], null)]).actie, "omhoog");
  });
});

describe("introfase en deload", () => {
  test("introtraining met 2 geplande sets op de bovenkant: daarna omhoog", () => {
    const intro: EerdereSessie = { ...sessie(20, [10, 10]), minSets: 2, doelRir: 3 };
    intro.sets.forEach((s) => (s.rir = 3));
    assert.equal(bepaalVoorstel(dumbbell, doel, [intro]).actie, "omhoog");
  });

  test("deloadtraining: zelfde gewicht als de laatste normale training", () => {
    const v = bepaalVoorstel(dumbbell, doel, [sessie(20, [10, 10, 10])], { deload: true });
    assert.equal(v.actie, "deload");
    assert.equal(v.gewicht, 20);
  });

  test("kniepijn gaat ook in de deloadweek voor", () => {
    const v = bepaalVoorstel(gobletSquat, doel, [sessie(20, [8, 8, 8], [5])], { deload: true });
    assert.equal(v.actie, "terug");
  });

  test("na een deload telt de laatste normale training voor progressie", () => {
    const deload: EerdereSessie = { ...sessie(20, [8, 8]), deload: true };
    const v = bepaalVoorstel(dumbbell, doel, [deload, sessie(20, [10, 10, 10])]);
    assert.equal(v.actie, "omhoog");
    assert.equal(v.gewicht, 22);
  });
});

describe("stagnatie", () => {
  test("twee trainingen op rij meer dan de helft onder de range: 10% terug", () => {
    const v = bepaalVoorstel(trapBar, { minSets: 3, repsMin: 6, repsMax: 8 }, [
      sessie(100, [6, 5, 5]),
      sessie(100, [5, 5, 6]),
    ]);
    assert.equal(v.actie, "terug");
    assert.equal(v.gewicht, 90);
    assert.equal(v.kniepijnRegel, false);
    assert.match(v.reden, /Twee trainingen op rij onder de 6 reps/);
  });

  test("één keer onder de range: nog zelfde gewicht", () => {
    const v = bepaalVoorstel(dumbbell, doel, [sessie(20, [7, 7, 7]), sessie(20, [9, 8, 8])]);
    assert.equal(v.actie, "gelijk");
  });

  test("precies de helft onder de range telt niet als stagnatie", () => {
    const v = bepaalVoorstel(dumbbell, doel, [sessie(20, [8, 8, 7, 7]), sessie(20, [8, 8, 7, 7])]);
    assert.equal(v.actie, "gelijk");
  });

  test("een deload ertussen telt niet mee", () => {
    const deload: EerdereSessie = { ...sessie(20, [10, 10]), deload: true };
    const v = bepaalVoorstel(dumbbell, doel, [sessie(20, [7, 6, 6]), deload, sessie(20, [7, 7, 6])]);
    assert.equal(v.actie, "terug");
    assert.equal(v.gewicht, 18);
  });

  test("zonder gewicht: makkelijkere variant", () => {
    const v = bepaalVoorstel(deadBug, doel, [sessie(null, [5, 5, 5]), sessie(null, [6, 5, 5])]);
    assert.equal(v.actie, "terug");
    assert.equal(v.gewicht, null);
  });
});
