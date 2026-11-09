import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AFSTANDEN,
  DUUR_DOELEN,
  DUUR_SPORTEN,
  DuurFout,
  maakDuurschema,
  standaardDuurdagen,
  verdeelOverWeek,
  weekUitSchema,
  weekVolumes,
  type DuurInstellingen,
  type DuurSport,
} from "../src/duurschema.js";

function alleInstellingen(): DuurInstellingen[] {
  const lijst: DuurInstellingen[] = [];
  for (const sport of Object.keys(DUUR_SPORTEN) as DuurSport[])
    for (const niveau of ["beginner", "gevorderd"] as const)
      for (const dagenPerWeek of [2, 3, 4])
        for (const doel of Object.keys(DUUR_DOELEN) as (keyof typeof DUUR_DOELEN)[]) {
          if (doel !== "afstand") lijst.push({ sport, doel, afstand: null, niveau, dagenPerWeek });
          else for (const a of AFSTANDEN[sport]) if (a.weken[niveau] !== null) lijst.push({ sport, doel, afstand: a.waarde, niveau, dagenPerWeek });
        }
  return lijst;
}

test("duurschema: elke combinatie geeft elke week precies zoveel sessies als dagen, met tijd en uitleg", () => {
  for (const i of alleInstellingen()) {
    const s = maakDuurschema(i);
    const naam = `${i.sport}/${i.doel}/${i.afstand ?? ""}/${i.niveau}/${i.dagenPerWeek}`;
    assert.ok(s.weken.length >= 6, naam);
    for (const w of s.weken) {
      assert.equal(w.sessies.length, i.dagenPerWeek, `${naam} week ${w.week}`);
      for (const x of w.sessies) {
        assert.ok(x.minuten >= 5 && x.minuten <= 300, `${naam} week ${w.week}: ${x.minuten} min`);
        assert.ok(x.uitleg.length > 10 && x.titel.length > 2, naam);
        if (i.sport === "zwemmen") assert.ok(x.meters && x.meters >= 100, naam);
      }
    }
  }
});

test("duurschema: hoogstens één harde sessie per week, beginners de eerste drie weken geen", () => {
  for (const i of alleInstellingen()) {
    const s = maakDuurschema(i);
    for (const w of s.weken) {
      const hard = w.sessies.filter((x) => x.rol === "kwaliteit");
      assert.ok(hard.length <= 1, `${i.sport} week ${w.week}`);
      if (i.niveau === "beginner" && w.week <= 3) assert.equal(hard.length, 0);
      if (w.thema.startsWith("Rustigere")) assert.equal(hard.length, 0, "geen harde sessie in een rustigere week");
    }
  }
});

test("duurschema: opbouw hoogstens ~10% per week, elke 4e week rustiger, en een rustige laatste week bij een afstand", () => {
  const i: DuurInstellingen = { sport: "hardlopen", doel: "afstand", afstand: 10, niveau: "gevorderd", dagenPerWeek: 3 };
  const v = weekVolumes(i);
  for (let w = 1; w < v.length - 1; w++) {
    if ((w + 1) % 4 === 0 || w % 4 === 0) continue; // herstelweek en de week erna
    assert.ok(v[w] <= v[w - 1] * 1.1 + 0.001, `week ${w + 1}`);
  }
  assert.ok(v[3] < v[2], "week 4 rustiger");
  assert.ok(v[v.length - 1] < Math.max(...v), "laatste week rustiger");
  const s = maakDuurschema(i);
  const laatste = s.weken[s.weken.length - 1];
  assert.ok(laatste.sessies.some((x) => x.rol === "doel" && /10 km/.test(x.uitleg)));
  assert.equal(s.doorlopend, false);
});

test("duurschema: hardlopen vanaf nul begint met wandelen en hardlopen afwisselen, en springt niet ineens naar lang", () => {
  const s = maakDuurschema({ sport: "hardlopen", doel: "afstand", afstand: 5, niveau: "beginner", dagenPerWeek: 3 });
  assert.match(s.weken[0].sessies[0].uitleg, /1 min rustig hardlopen, 2 min wandelen/);
  const eersteDoorlopend = s.weken.find((w) => w.sessies.every((x) => !/wandelen/.test(x.titel.toLowerCase())))!;
  assert.ok(eersteDoorlopend.sessies.every((x) => x.minuten <= 35), "eerst 25–35 minuten aan één stuk");
});

test("duurschema: halve marathon vanaf nul kan niet; rommel geeft een duidelijke fout", () => {
  assert.throws(() => maakDuurschema({ sport: "hardlopen", doel: "afstand", afstand: 21.1, niveau: "beginner", dagenPerWeek: 3 }), DuurFout);
  assert.throws(() => maakDuurschema({ sport: "hardlopen", doel: "afstand", afstand: 7, niveau: "gevorderd", dagenPerWeek: 3 }), DuurFout);
  assert.throws(() => maakDuurschema({ sport: "hardlopen", doel: "conditie", afstand: null, niveau: "gevorderd", dagenPerWeek: 5 }), DuurFout);
});

test("duurschema: conditie loopt door (onderhoud), een afstand stopt na je doel", () => {
  const conditie = maakDuurschema({ sport: "fietsen", doel: "conditie", afstand: null, niveau: "gevorderd", dagenPerWeek: 2 });
  assert.match(weekUitSchema(conditie, 20)!.thema, /Onderhoud/);
  const afstand = maakDuurschema({ sport: "zwemmen", doel: "afstand", afstand: 500, niveau: "gevorderd", dagenPerWeek: 2 });
  assert.equal(weekUitSchema(afstand, afstand.weken.length + 1), null);
  assert.equal(weekUitSchema(afstand, 0), null);
});

test("duurschema: zwemmen naar een afstand bouwt het stuk aan één stuk geleidelijk op", () => {
  const s = maakDuurschema({ sport: "zwemmen", doel: "afstand", afstand: 1000, niveau: "beginner", dagenPerWeek: 3 });
  const stukken = s.weken.map((w) => Number(/^(\d+) m rustig aan één stuk/.exec(w.sessies.find((x) => x.rol === "lang")?.uitleg ?? "")?.[1] ?? 0)).filter(Boolean);
  for (let k = 1; k < stukken.length; k++) assert.ok(stukken[k] - stukken[k - 1] <= 200, `stap ${stukken[k - 1]} → ${stukken[k]}`);
});

test("verdelen over de week: lang in het weekend, hard niet op of vlak voor een benendag", () => {
  const s = maakDuurschema({ sport: "hardlopen", doel: "conditie", afstand: null, niveau: "gevorderd", dagenPerWeek: 3 });
  const plek = verdeelOverWeek(s.weken[1].sessies, [2, 4, 6], [5]); // benen op vrijdag
  assert.equal(plek.get(6)?.rol, "lang");
  const hardOp = [...plek].find(([, x]) => x.rol === "kwaliteit")?.[0];
  assert.ok(hardOp !== 4 && hardOp !== 5, `hard op dag ${hardOp}`);
  // Zwemmen belast je benen nauwelijks: daar maakt het niet uit.
  assert.equal(verdeelOverWeek(maakDuurschema({ sport: "zwemmen", doel: "conditie", afstand: null, niveau: "gevorderd", dagenPerWeek: 2 }).weken[2].sessies, [3, 4], [4]).size, 2);
});

test("standaard duurdagen: eerst dagen zonder krachttraining, met het weekend", () => {
  assert.deepEqual(standaardDuurdagen(2, [1, 3, 5]), [2, 6]);
  assert.deepEqual(standaardDuurdagen(3, [1, 2, 4, 5]), [3, 6, 7]);
  assert.equal(standaardDuurdagen(4, [1, 2, 3, 4, 5, 6, 7]).length, 4);
});
