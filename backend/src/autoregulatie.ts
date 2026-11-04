// Pure logica (Pro): het gewicht voor je volgende set binnen dezelfde training, op basis van hoe
// zwaar de vorige voelde (RIR). Het voorstel vóór de training (progressie.ts) blijft leidend en
// verandert hierdoor niet; dit stuurt alleen binnen de training bij, en nooit meer dan één stap
// omhoog. Zie Wetenschap, #autoregulatie.
//
// Afgewogen: een volledige RPE-tabel (gewicht uit een %1RM per RPE). Die vraagt een goede 1RM en
// veel invulwerk tijdens de training; deze regel heeft alleen de RIR nodig die je al invult.

import { PIJN_GRENS, rondOmlaag, type GelogdeSet } from "./progressie.js";

export type Bijsturing = {
  actie: "omhoog" | "gelijk" | "omlaag" | "pijn";
  gewicht: number;
  reden: string;
};

const kgTekst = (w: number) => `${String(Math.round(w * 100) / 100).replace(".", ",")} kg`;

/**
 * @param sets de werksets die je vandaag al deed, in volgorde
 * @param doel rep-range en doel-RIR van vandaag (zonder doel-RIR rekenen we met 2)
 * @returns null als er niets bij te sturen valt (geen gewicht, geen RIR ingevuld, of geen set meer gepland)
 */
export function bijsturing(
  oefening: { gewichtsstap: number },
  doel: { repsMin: number; repsMax: number; doelRir: number | null; aantalSets: number },
  sets: GelogdeSet[],
): Bijsturing | null {
  const laatste = sets[sets.length - 1];
  const stap = oefening.gewichtsstap;
  if (!laatste || stap <= 0 || laatste.gewicht === null || sets.length >= doel.aantalSets) return null;
  const gewicht = laatste.gewicht;

  if (laatste.pijn !== null && laatste.pijn >= PIJN_GRENS) {
    const lichter = Math.max(0, rondOmlaag(Math.min(gewicht * 0.9, gewicht - stap), stap));
    return {
      actie: "pijn",
      gewicht: lichter,
      reden: `Pijn ${laatste.pijn}/10: volgende set 10% lichter (${kgTekst(lichter)}), of stop met deze oefening voor vandaag.`,
    };
  }
  if (laatste.rir === null) return null;
  const doelRir = doel.doelRir ?? 2;

  if (laatste.reps < doel.repsMin || laatste.rir <= doelRir - 2) {
    const lichter = Math.max(0, rondOmlaag(Math.min(gewicht * 0.95, gewicht - stap), stap));
    const waarom = laatste.reps < doel.repsMin ? `${laatste.reps} reps, onder de ${doel.repsMin}` : `RIR ${laatste.rir}, zwaarder dan je doel (${doelRir})`;
    return { actie: "omlaag", gewicht: lichter, reden: `${waarom}: volgende set ${kgTekst(lichter)}.` };
  }
  if (laatste.reps >= doel.repsMax && laatste.rir >= doelRir + 2) {
    const zwaarder = Math.round((gewicht + stap) * 100) / 100;
    return {
      actie: "omhoog",
      gewicht: zwaarder,
      reden: `${laatste.reps} reps met ${laatste.rir} over: lichter dan bedoeld. Volgende set één stap zwaarder (${kgTekst(zwaarder)}).`,
    };
  }
  return { actie: "gelijk", gewicht, reden: `RIR ${laatste.rir} bij een doel van ${doelRir}: precies goed. Zelfde gewicht.` };
}
