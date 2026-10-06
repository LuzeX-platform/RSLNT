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

const dumbbell = { materiaal: "dumbbell", gewichtsstap: 2 };
const trapBar = { materiaal: "barbell", gewichtsstap: 2.5 };
const deadBug = { materiaal: "lichaamsgewicht", gewichtsstap: 0 };
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
    const v = bepaalVoorstel({ materiaal: "kabel", gewichtsstap: 2.5 }, doel, [sessie(37.5, [10, 10, 10])]);
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
    const v = bepaalVoorstel(dumbbell, doel, [sessie(12, [8, 8, 8], [6])]);
    assert.equal(v.gewicht, 10);
  });

  test("afronden naar beneden op wat er in het rek ligt", () => {
    // 22 kg × 0,9 = 19,8 → 18 kg bij stappen van 2 kg.
    assert.equal(bepaalVoorstel(dumbbell, doel, [sessie(22, [8, 8, 8], [4])]).gewicht, 18);
  });

  test("nooit onder nul", () => {
    assert.equal(bepaalVoorstel(dumbbell, doel, [sessie(2, [8, 8, 8], [7])]).gewicht, 0);
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
    const v = bepaalVoorstel(deadBug, doel, [sessie(null, [10, 10, 10], [5])]);
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
