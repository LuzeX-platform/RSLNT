// Pro: je wens in eigen woorden → de keuzes van Schema op maat. Claude leest de tekst en kiest
// alleen uit de vaste opties van het formulier. Wat terugkomt gaat daarna door een controle in
// code (normaliseerWens): onbekende waarden vallen weg, dagen en minuten worden op een bestaande
// knop gezet. De vangrail zit dus ná de AI, niet in de prompt. Er wordt niets opgeslagen: de app
// zet de keuzes in het formulier, jij past aan en maakt dan zelf het voorstel (generator.ts).

import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { BLESSURES, DOELEN, ERVARING, MATERIAAL_KEUZES, weekdoelen } from "./generator.js";
import { ALLE_SPIER_LABELS } from "./spieren.js";

export const MODEL = "claude-opus-5-5";
export const MAX_TEKST = 1000;
const DAGEN = [2, 3, 4, 5, 6];
const MINUTEN = [30, 45, 60, 75, 90, 120];
const MAX_FOCUS = 3;
const FOCUS_SPIEREN = Object.keys(weekdoelen({ doel: "spiermassa", ervaring: "gevorderd", focus: [] }));

/** Wat Claude mag teruggeven. null = niet genoemd: dan blijft wat er al in het formulier staat. */
export interface WensKeuzes {
  doel: string | null;
  ervaring: string | null;
  dagenPerWeek: number | null;
  minutenPerTraining: number | null;
  materiaal: string[] | null;
  blessures: string[] | null;
  focus: string[] | null;
  doelgewicht: number | null;
}

export interface WensVertaling {
  keuzes: Partial<Record<keyof WensKeuzes, unknown>>;
  /** Eén tot drie zinnen: wat er is ingevuld en waarom. */
  uitleg: string;
  /** Wensen die niet in de opties passen, zodat je weet wat RSLNT er niet mee doet. */
  nietGelukt: string[];
}

const ofNull = (schema: object) => ({ anyOf: [schema, { type: "null" }] });
const enumLijst = (waarden: string[]) => ofNull({ type: "array", items: { type: "string", enum: waarden } });

const UITVOER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["doel", "ervaring", "dagenPerWeek", "minutenPerTraining", "materiaal", "blessures", "focus", "doelgewicht", "uitleg", "nietGelukt"],
  properties: {
    doel: ofNull({ type: "string", enum: Object.keys(DOELEN) }),
    ervaring: ofNull({ type: "string", enum: Object.keys(ERVARING) }),
    dagenPerWeek: ofNull({ type: "integer", enum: DAGEN }),
    minutenPerTraining: ofNull({ type: "integer", enum: MINUTEN }),
    materiaal: enumLijst(Object.keys(MATERIAAL_KEUZES)),
    blessures: enumLijst(Object.keys(BLESSURES)),
    focus: enumLijst(FOCUS_SPIEREN),
    doelgewicht: ofNull({ type: "number" }),
    uitleg: { type: "string" },
    nietGelukt: { type: "array", items: { type: "string" } },
  },
} as const;

const opties = (lijst: Record<string, string>) =>
  Object.entries(lijst)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join("\n");

// Vast (geen datum of gebruikersgegevens erin), zodat het een stabiel voorvoegsel is.
const SYSTEEM = `Je helpt in de trainingsapp RSLNT. Iemand beschrijft in eigen woorden (Nederlands, soms ingesproken en dus rommelig) wat voor training hij wil of wat zijn doel is. Zet dat om naar de vaste keuzes van het formulier "Schema op maat". Kies uitsluitend uit deze opties:

doel:
${opties(DOELEN)}
ervaring (hoe lang iemand al traint):
${opties(ERVARING)}
dagenPerWeek: ${DAGEN.join(", ")}
minutenPerTraining: ${MINUTEN.join(", ")} (kies de dichtstbijzijnde)
materiaal (wat iemand kan gebruiken; lichaamsgewicht kan altijd en hoort er niet bij):
${opties(MATERIAAL_KEUZES)}
blessures (alleen klachten die iemand noemt):
${opties(BLESSURES)}
focus (spiergroepen die extra aandacht moeten krijgen, hoogstens ${MAX_FOCUS}):
${opties(Object.fromEntries(FOCUS_SPIEREN.map((s) => [s, ALLE_SPIER_LABELS[s] ?? s])))}
doelgewicht: lichaamsgewicht in kg, alleen als iemand een getal noemt.

Regels:
- Vul alleen in wat de tekst zegt of duidelijk bedoelt. Wat niet genoemd wordt: null. Raad niet.
- "Sportschool" of "gym" zonder meer betekent: dumbbell, barbell, kabel, machine en stang. "Thuis" zonder meer: alleen wat iemand noemt.
- "Afvallen" of "strakker worden" is vetverlies; "sterker" is kracht; "spieren erbij" of "breder" is spiermassa; "fit blijven" of "gezond" is fit.
- uitleg: één tot drie korte zinnen in het Nederlands, aangesproken met "je", over wat je hebt ingevuld.
- nietGelukt: wensen die niet in deze opties passen (bijvoorbeeld een sport, een datum, een specifieke oefening, een blessure die er niet tussen staat), elk als korte Nederlandse zin. Leeg als alles past.
- Medische vragen beantwoord je niet; noem een klacht die er niet tussen staat in nietGelukt.`;

/** Alleen echte opties, op een bestaande knop. Alles wat niet klopt valt weg (wordt null). */
export function normaliseerWens(ruw: unknown): WensVertaling {
  const r = (typeof ruw === "object" && ruw !== null ? ruw : {}) as Record<string, unknown>;
  const enkel = (waarde: unknown, toegestaan: string[]) => (typeof waarde === "string" && toegestaan.includes(waarde) ? waarde : undefined);
  const lijst = (waarde: unknown, toegestaan: string[], max = toegestaan.length) =>
    Array.isArray(waarde) ? [...new Set(waarde.filter((w): w is string => typeof w === "string" && toegestaan.includes(w)))].slice(0, max) : undefined;
  const dichtstbij = (waarde: unknown, knoppen: number[]) =>
    typeof waarde === "number" && Number.isFinite(waarde) ? knoppen.reduce((a, b) => (Math.abs(b - waarde) < Math.abs(a - waarde) ? b : a)) : undefined;

  const keuzes: WensVertaling["keuzes"] = {
    doel: enkel(r.doel, Object.keys(DOELEN)),
    ervaring: enkel(r.ervaring, Object.keys(ERVARING)),
    dagenPerWeek: dichtstbij(r.dagenPerWeek, DAGEN),
    minutenPerTraining: dichtstbij(r.minutenPerTraining, MINUTEN),
    materiaal: lijst(r.materiaal, Object.keys(MATERIAAL_KEUZES)),
    blessures: lijst(r.blessures, Object.keys(BLESSURES)),
    focus: lijst(r.focus, FOCUS_SPIEREN, MAX_FOCUS),
    doelgewicht: typeof r.doelgewicht === "number" && r.doelgewicht >= 30 && r.doelgewicht <= 300 ? Math.round(r.doelgewicht * 10) / 10 : undefined,
  };
  for (const k of Object.keys(keuzes) as (keyof WensKeuzes)[]) if (keuzes[k] === undefined) delete keuzes[k];
  // Een lege lijst materiaal zou "alleen lichaamsgewicht" betekenen; dat zeggen we alleen als het er staat.
  if (Array.isArray(keuzes.materiaal) && keuzes.materiaal.length === 0 && r.materiaal !== null) delete keuzes.materiaal;

  const tekst = (w: unknown, max: number) => (typeof w === "string" ? w.trim().slice(0, max) : "");
  return {
    keuzes,
    uitleg: tekst(r.uitleg, 500),
    nietGelukt: Array.isArray(r.nietGelukt) ? r.nietGelukt.map((x) => tekst(x, 200)).filter(Boolean).slice(0, 5) : [],
  };
}

export class WensFout extends Error {
  constructor(
    public readonly code: "AI_NIET_BESCHIKBAAR" | "WENS_NIET_GELUKT",
    bericht: string,
  ) {
    super(bericht);
  }
}

/** De vraag aan Claude. Alleen de tekst gaat mee: geen naam, e-mail of andere gegevens. */
export type WensVrager = (tekst: string) => Promise<unknown>;

export const vraagClaude: WensVrager = async (tekst) => {
  if (!process.env.ANTHROPIC_API_KEY) throw new WensFout("AI_NIET_BESCHIKBAAR", "ANTHROPIC_API_KEY ontbreekt");
  const client = new Anthropic();
  let antwoord: Anthropic.Beta.BetaMessage;
  try {
    antwoord = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      // Een eenvoudige vertaling naar keuzes: weinig nadenken is genoeg en houdt het snel.
      output_config: { effort: "low", format: { type: "json_schema", schema: UITVOER_SCHEMA } },
      // Weigert het model (veiligheidsfilter), dan probeert de API het zelf op een ander model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: SYSTEEM,
      messages: [{ role: "user", content: tekst }],
    });
  } catch (fout) {
    if (fout instanceof Anthropic.APIError) throw new WensFout("WENS_NIET_GELUKT", `Anthropic ${fout.status}: ${fout.message}`);
    throw new WensFout("WENS_NIET_GELUKT", `Anthropic niet bereikbaar: ${String(fout)}`);
  }
  if (antwoord.stop_reason === "refusal") throw new WensFout("WENS_NIET_GELUKT", "Geweigerd door het model");
  if (antwoord.stop_reason === "max_tokens") throw new WensFout("WENS_NIET_GELUKT", "Antwoord afgekapt");
  const json = antwoord.content.find((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")?.text;
  if (!json) throw new WensFout("WENS_NIET_GELUKT", "Leeg antwoord");
  try {
    return JSON.parse(json);
  } catch {
    throw new WensFout("WENS_NIET_GELUKT", "Geen geldige JSON");
  }
};

let vrager: WensVrager = vraagClaude;
/** Alleen voor tests: een nep-Claude, zodat de API-test geen echte (betaalde) verzoeken doet. */
export function zetWensVrager(nieuw: WensVrager | null) {
  vrager = nieuw ?? vraagClaude;
}

export const wensSchema = z.object({ tekst: z.string().trim().min(3, "Vertel iets meer").max(MAX_TEKST, `Hoogstens ${MAX_TEKST} tekens`) });

export async function vertaalWens(tekst: string): Promise<WensVertaling> {
  return normaliseerWens(await vrager(tekst));
}
