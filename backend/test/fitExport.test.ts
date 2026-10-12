import { test } from "node:test";
import assert from "node:assert/strict";
import { Decoder, Profile, Stream } from "@garmin/fitsdk";
import { garminOefening, maakFit, tijdlijn, tijdzoneVerschil, type FitTraining } from "../src/fitExport.js";
import { CATALOGUS } from "../src/catalogus.js";

const START = new Date("2026-10-12T16:00:00Z");
const na = (minuten: number) => new Date(START.getTime() + minuten * 60_000);

function training(over: Partial<FitTraining> = {}): FitTraining {
  return {
    id: "training-1",
    titel: "RSLNT A: Benen",
    datum: START,
    afgerondOp: na(40),
    oefeningen: [
      {
        sleutel: "trap_bar_deadlift",
        bibliotheekId: null,
        spierenPrimair: ["quads"],
        rustSeconden: 150,
        sets: [
          { gewicht: 100, reps: 8, opgeslagenOp: na(5) },
          { gewicht: 102.5, reps: 7, opgeslagenOp: na(8) },
        ],
      },
      {
        sleutel: "eigen_oefening",
        bibliotheekId: null,
        spierenPrimair: ["abs"],
        rustSeconden: null,
        sets: [{ gewicht: null, reps: 12, opgeslagenOp: na(12) }],
      },
    ],
    ...over,
  };
}

function lees(bytes: Uint8Array) {
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  assert.ok(decoder.checkIntegrity(), "geldig FIT-bestand met kloppende CRC");
  const { messages, errors } = decoder.read();
  assert.deepEqual(errors, []);
  return messages;
}

test("FIT: krachttraining met per set reps, gewicht en Garmin-oefening", () => {
  const m = lees(maakFit(training()));
  assert.equal(m.fileIdMesgs[0].type, "activity");
  assert.equal(m.sessionMesgs[0].sport, "training");
  assert.equal(m.sessionMesgs[0].subSport, "strengthTraining");
  assert.equal(m.sportMesgs[0].name, "RSLNT A: Benen");
  assert.equal(m.activityMesgs.length, 1);
  assert.ok(m.recordMesgs.length > 0, "een activiteit hoort records te hebben");

  const actief = m.setMesgs.filter((s) => s.setType === "active");
  assert.deepEqual(
    actief.map((s) => [s.repetitions, s.weight]),
    [
      [8, 100],
      [7, 102.5],
      [12, undefined],
    ],
  );
  // Trap bar deadlift is in Garmins indeling deadlift → trapBarDeadlift.
  assert.deepEqual(actief[0].category, ["deadlift"]);
  assert.deepEqual(actief[0].categorySubtype, [17]);
  // Een eigen oefening zonder koppeling: op de primaire spier (buik → core).
  assert.deepEqual(actief[2].category, ["core"]);
  // Rust tussen de sets.
  assert.ok(m.setMesgs.some((s) => s.setType === "rest"));
});

test("FIT: tijden uit het loggen, met rust ertussen en een plausibele duur", () => {
  const { blokken, echteTijden } = tijdlijn(training());
  assert.equal(echteTijden, true);
  const laatste = blokken[blokken.length - 1];
  assert.equal(laatste.soort, "actief");
  assert.equal(laatste.eind, na(12).getTime(), "de training eindigt bij de laatste set, niet bij het afronden");
  for (let i = 1; i < blokken.length; i++) assert.equal(blokken[i].start, blokken[i - 1].eind, "aansluitend");
  // Ruim voor de eerste set geopend: hoogstens een kwartier vóór de eerste set telt mee.
  const laat = training({
    datum: na(-60),
    oefeningen: [{ ...training().oefeningen[0], sets: [{ gewicht: 100, reps: 8, opgeslagenOp: na(5) }] }],
  });
  const t = tijdlijn(laat);
  assert.equal(t.echteTijden, true);
  assert.ok(t.blokken[t.blokken.length - 1].eind - t.blokken[0].start <= 16 * 60_000);
});

test("FIT: alles achteraf ingevuld of later aangepast → nette reconstructie met de rusttijden", () => {
  const achteraf = training({
    oefeningen: training().oefeningen.map((o, i) => ({
      ...o,
      sets: o.sets.map((s, j) => ({ ...s, opgeslagenOp: new Date(na(41).getTime() + (i * 10 + j) * 2000) })),
    })),
  });
  const { blokken, echteTijden } = tijdlijn(achteraf);
  assert.equal(echteTijden, false);
  assert.equal(blokken[0].start, START.getTime());
  assert.deepEqual(
    blokken.map((b) => [b.soort, (b.eind - b.start) / 1000]),
    [
      ["actief", 32],
      ["rust", 150],
      ["actief", 28],
      ["rust", 150],
      ["actief", 48],
    ],
  );
  lees(maakFit(achteraf));
});

test("FIT: zelfde training geeft hetzelfde bestand (Garmin herkent een dubbele import)", () => {
  assert.deepEqual(maakFit(training()), maakFit(training()));
  assert.notDeepEqual(maakFit(training()), maakFit(training({ id: "training-2" })));
});

test("FIT: zonder sets geen bestand", () => {
  assert.throws(() => maakFit(training({ oefeningen: [] })));
});

test("FIT: elke oefening uit de basislijst heeft een geldige Garmin-categorie", () => {
  const categorieen = Profile.types.exerciseCategory;
  for (const c of CATALOGUS) {
    const g = garminOefening({ sleutel: c.sleutel, bibliotheekId: null, spierenPrimair: [] });
    assert.notEqual(categorieen[g.categorie], "unknown", `${c.sleutel} heeft geen Garmin-categorie`);
    if (g.naam !== undefined) {
      const namen = Profile.types[`${categorieen[g.categorie]}ExerciseName`];
      assert.ok(namen?.[g.naam], `${c.sleutel}: naam ${g.naam} bestaat niet in ${categorieen[g.categorie]}`);
    }
  }
});

test("FIT: lokale tijd volgt zomer- en wintertijd in Nederland", () => {
  assert.equal(tijdzoneVerschil(new Date("2026-07-01T12:00:00Z")), 7200);
  assert.equal(tijdzoneVerschil(new Date("2026-12-01T12:00:00Z")), 3600);
});
