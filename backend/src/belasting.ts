// Pure logica (Pro): advies voor vandaag — gewoon trainen, een lichte dag of een deloadweek —
// uit je herstelchecks, oefeningen die vastlopen, pijn die oploopt en hoe lang je laatste deload
// geleden is. Geen totaalscore (zie herstel.ts): elke reden staat los in het advies, met wat
// er telde. Het gratis deel (herstel.ts) stelt hooguit voor een deload te overwegen; dit maakt
// er een concrete keuze van, die je zelf start. Zie Wetenschap, #slim-herstel.

import { deloadOverwegen, HERSTEL_ITEMS, status, type HerstelItem, type HerstelWaarden } from "./herstel.js";

export type Advies = "normaal" | "lichte_dag" | "deload";

export interface AdviesInvoer {
  /** De check van vandaag, of null. */
  vandaag: HerstelWaarden | null;
  /** Recente checks, nieuwste eerst (die van vandaag meegerekend). */
  checks: HerstelWaarden[];
  /** Oefeningen waarvan het voorstel 10% terug is door stagnatie (niet door pijn). */
  stagnerend: string[];
  /** Oefeningen waar de pijnregel ingrijpt. */
  pijn: string[];
  /** Weken sinds je laatste deloadtraining, of sinds de start van je programma. */
  wekenSindsDeload: number | null;
}

/** Na zoveel weken zonder deload telt "lang geleden" mee als reden. Praktijkregel. */
export const WEKEN_ZONDER_DELOAD = 6;

export function adviesVoorVandaag(invoer: AdviesInvoer): { advies: Advies; redenen: string[] } {
  const redenen: string[] = [];
  const letOpVandaag = invoer.vandaag
    ? (Object.keys(HERSTEL_ITEMS) as HerstelItem[]).filter((i) => status(i, invoer.vandaag![i]) === "let_op")
    : [];
  const herhaald = deloadOverwegen(invoer.checks);
  const lang = invoer.wekenSindsDeload !== null && invoer.wekenSindsDeload >= WEKEN_ZONDER_DELOAD;

  if (letOpVandaag.length) {
    redenen.push(`Vandaag ${letOpVandaag.length === 1 ? "één signaal" : `${letOpVandaag.length} signalen`} op "let op": ${letOpVandaag.map((i) => HERSTEL_ITEMS[i].label.toLowerCase()).join(", ")}.`);
  }
  if (herhaald) redenen.push("In twee van je laatste drie checks stonden twee of meer signalen op \"let op\".");
  if (invoer.stagnerend.length) {
    redenen.push(`${invoer.stagnerend.length === 1 ? "Eén oefening loopt" : `${invoer.stagnerend.length} oefeningen lopen`} vast: ${invoer.stagnerend.join(", ")}.`);
  }
  if (invoer.pijn.length) redenen.push(`Pijn loopt op bij ${invoer.pijn.join(", ")}.`);
  if (lang) redenen.push(`Je laatste deload is ${invoer.wekenSindsDeload} weken geleden.`);

  let advies: Advies = "normaal";
  if ((herhaald && (invoer.stagnerend.length >= 2 || lang)) || invoer.stagnerend.length >= 3) advies = "deload";
  else if (letOpVandaag.length >= 2 || herhaald || invoer.pijn.length > 0) advies = "lichte_dag";

  if (redenen.length === 0) {
    redenen.push(invoer.vandaag ? "Je herstel ziet er goed uit en niets loopt vast." : "Niets loopt vast. Vul je herstelcheck in voor een vollediger advies.");
  }
  return { advies, redenen };
}
