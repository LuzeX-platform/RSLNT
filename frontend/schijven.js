// Schijvencalculator (gratis): welke schijven per kant op de stang voor een gewicht. Bewust in de
// frontend en niet in de backend (waar de formules horen, zie CLAUDE.md): dit is inpakken, geen
// trainingsformule, en het moet in de sportschool zonder bereik bij elke tik op +/− meteen
// bijwerken. De test staat in backend/test/schijven.test.ts.

/** Gangbare schijven in een sportschool, zwaarste eerst. */
const SCHIJVEN = [25, 20, 15, 10, 5, 2.5, 1.25];

/**
 * Schijven per kant voor een totaalgewicht, zwaarste eerst. Lukt het niet precies met de
 * gangbare schijven, dan staat het verschil in `rest` (totaal, beide kanten samen).
 * @returns null als het gewicht lichter is dan de stang zelf
 */
function schijvenPerKant(totaal, stang = 20, schijven = SCHIJVEN) {
  if (!(totaal >= stang)) return null;
  // Rekenen in honderdsten, zodat 2,5 + 1,25 geen afrondingsfout geeft.
  let over = Math.round(((totaal - stang) / 2) * 100);
  const perKant = [];
  for (const schijf of schijven) {
    const s = Math.round(schijf * 100);
    while (over >= s) {
      perKant.push(schijf);
      over -= s;
    }
  }
  return { perKant, rest: (over * 2) / 100 };
}

/** "20 + 10 + 2,5 per kant" of "alleen de stang". */
function schijvenTekst(totaal, stang = 20) {
  const r = schijvenPerKant(totaal, stang);
  if (!r) return `lichter dan de stang (${String(stang).replace(".", ",")} kg)`;
  const getalNl = (w) => String(w).replace(".", ",");
  const basis = r.perKant.length ? `${r.perKant.map(getalNl).join(" + ")} per kant` : "alleen de stang";
  return r.rest > 0 ? `${basis} (${getalNl(r.rest)} kg past niet precies)` : basis;
}

if (typeof module !== "undefined") module.exports = { schijvenPerKant, schijvenTekst, SCHIJVEN };
