import { test } from "node:test";
import assert from "node:assert/strict";
import { metGemiddelde, zevenDaagsGemiddelde } from "../src/gewicht.js";
import { isDag, vandaag, verschuifDag } from "../src/datum.js";

const metingen = [
  { datum: "2026-10-01", gewicht: 81 },
  { datum: "2026-10-03", gewicht: 81.4 },
  { datum: "2026-10-07", gewicht: 81.6 },
  { datum: "2026-10-08", gewicht: 82 },
];

test("7-daags gemiddelde: alleen de zeven dagen tot en met de dag zelf", () => {
  // 2026-10-02 t/m 2026-10-08: 81,4 + 81,6 + 82
  assert.equal(zevenDaagsGemiddelde(metingen, "2026-10-08"), 81.67);
  // 2026-10-01 t/m 2026-10-07: 81 + 81,4 + 81,6
  assert.equal(zevenDaagsGemiddelde(metingen, "2026-10-07"), 81.33);
});

test("7-daags gemiddelde: geen wegingen in het venster → null", () => {
  assert.equal(zevenDaagsGemiddelde(metingen, "2026-10-20"), null);
});

test("metGemiddelde: nieuwste eerst, met het gemiddelde op die dag", () => {
  const rijen = metGemiddelde(metingen);
  assert.equal(rijen[0].datum, "2026-10-08");
  assert.equal(rijen[0].gemiddelde7, 81.67);
  assert.equal(rijen[3].gemiddelde7, 81);
});

test("vandaag is in Nederlandse tijd", () => {
  // 22:30 UTC op 5 oktober is al 6 oktober in Amsterdam (zomertijd, UTC+2).
  assert.equal(vandaag(new Date("2026-10-05T22:30:00Z")), "2026-10-06");
  assert.equal(vandaag(new Date("2026-10-05T21:30:00Z")), "2026-10-05");
});

test("dagen verschuiven over een maandgrens", () => {
  assert.equal(verschuifDag("2026-10-03", -6), "2026-09-27");
});

test("isDag weigert onzin en niet-bestaande dagen", () => {
  assert.equal(isDag("2026-10-05"), true);
  assert.equal(isDag("2026-02-30"), false);
  assert.equal(isDag("5-10-2026"), false);
});
