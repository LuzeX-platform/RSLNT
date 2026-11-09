import { test } from "node:test";
import assert from "node:assert/strict";
import { aanDeBeurt, maandagVan, standaardDagen, weekdagVan } from "../src/planning.js";
import { ical, maakAgenda, vouw } from "../src/agenda.js";

test("weekdagen: maandag 1 … zondag 7, maandag van de week", () => {
  assert.equal(weekdagVan("2026-11-09"), 1); // maandag
  assert.equal(weekdagVan("2026-11-11"), 3);
  assert.equal(weekdagVan("2026-11-15"), 7);
  assert.equal(maandagVan("2026-11-15"), "2026-11-09");
  assert.equal(maandagVan("2026-11-09"), "2026-11-09");
});

test("standaardindeling: rust ertussen, weekend pas als het moet", () => {
  assert.deepEqual(standaardDagen(2), [1, 4]);
  assert.deepEqual(standaardDagen(3), [1, 3, 5]);
  assert.deepEqual(standaardDagen(4), [1, 2, 4, 5]);
  assert.deepEqual(standaardDagen(5), [1, 2, 3, 4, 5]);
  assert.equal(standaardDagen(9).length, 7);
});

test("aan de beurt: vandaag gepland, anders de eerstvolgende dag", () => {
  const plan = [
    { weekdag: 3, schemaId: "rug", tijd: "18:00" },
    { weekdag: 5, schemaId: "benen", tijd: "07:30" },
  ];
  // Woensdag: rug vandaag, daarna benen op vrijdag.
  let b = aanDeBeurt(plan, "2026-11-11", new Set());
  assert.equal(b.vandaag?.schemaId, "rug");
  assert.deepEqual([b.volgende?.schemaId, b.volgende?.datum], ["benen", "2026-11-13"]);
  // Al gedaan vandaag: niets meer vandaag.
  b = aanDeBeurt(plan, "2026-11-11", new Set(["rug"]));
  assert.equal(b.vandaag, null);
  // Zaterdag: rust, volgende is woensdag.
  b = aanDeBeurt(plan, "2026-11-14", new Set());
  assert.equal(b.vandaag, null);
  assert.deepEqual([b.volgende?.schemaId, b.volgende?.datum], ["rug", "2026-11-18"]);
  // Vrijdag al op dinsdag gedaan: woensdag blijft, en daarna is het volgende week.
  b = aanDeBeurt(plan, "2026-11-10", new Set(["benen"]));
  assert.deepEqual([b.volgende?.schemaId, b.volgende?.datum], ["rug", "2026-11-11"]);
  b = aanDeBeurt(plan, "2026-11-11", new Set(["benen", "rug"]));
  assert.deepEqual([b.vandaag, b.volgende?.datum], [null, "2026-11-18"]);
  // Eén dag gepland en die is vandaag: de volgende is over een week.
  assert.equal(aanDeBeurt([plan[0]], "2026-11-11", new Set()).volgende?.datum, "2026-11-18");
  assert.deepEqual(aanDeBeurt([], "2026-11-11", new Set()), { vandaag: null, volgende: null });
});

test("agenda: geldig iCal met wekelijks terugkerende afspraken in Nederlandse tijd", () => {
  const tekst = maakAgenda(
    [
      { weekdag: 5, tijd: "07:30", schemaId: "s2", naam: "Benen", minuten: 50, oefeningen: ["Leg press: 3 × 8–12"] },
      { weekdag: 3, tijd: "18:00", schemaId: "s1", naam: "Rug en biceps", minuten: 45, oefeningen: ["Lat pulldown: 3 × 8–12", "Hammer curl: 2 × 10–15"] },
    ],
    { dag: "2026-11-12", nu: new Date("2026-11-12T10:00:00Z"), appUrl: "https://rslnt.luzex.nl" },
  );
  assert.ok(tekst.startsWith("BEGIN:VCALENDAR\r\n") && tekst.endsWith("END:VCALENDAR\r\n"));
  assert.equal(tekst.match(/BEGIN:VEVENT/g)?.length, 2);
  // De reeks begint deze week (ook als die dag al voorbij is), op woensdag en vrijdag.
  assert.ok(tekst.includes("DTSTART;TZID=Europe/Amsterdam:20261111T180000"));
  assert.ok(tekst.includes("RRULE:FREQ=WEEKLY;BYDAY=WE"));
  assert.ok(tekst.includes("DTSTART;TZID=Europe/Amsterdam:20261113T073000"));
  assert.ok(tekst.includes("RRULE:FREQ=WEEKLY;BYDAY=FR"));
  assert.ok(tekst.includes("DURATION:PT45M"));
  assert.ok(tekst.includes("SUMMARY:Training: Rug en biceps"));
  assert.ok(tekst.includes("UID:s1-3@rslnt"));
  assert.ok(tekst.includes("BEGIN:VTIMEZONE"));
  // Elke regel hoogstens 75 bytes, regeleinden CRLF.
  for (const regel of tekst.split("\r\n")) assert.ok(Buffer.byteLength(regel) <= 75, regel);
  assert.ok(!/[^\r]\n/.test(tekst));
});

test("agenda: tekst escapen en lange regels vouwen zonder een teken te breken", () => {
  assert.equal(ical("a, b; c\\d\ne"), "a\\, b\\; c\\\\d\\ne");
  const lang = "DESCRIPTION:" + "é".repeat(60);
  const gevouwen = vouw(lang);
  assert.ok(gevouwen.split("\r\n").every((r) => Buffer.byteLength(r) <= 75));
  assert.equal(gevouwen.replace(/\r\n /g, ""), lang);
});
