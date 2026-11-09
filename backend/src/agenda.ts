// Je weekplanning als agenda-abonnement (iCalendar, RFC 5545), voor Apple Agenda, Google Agenda
// en Outlook. Per geplande dag één wekelijks terugkerende afspraak, met de oefeningen erin. Pure
// logica: de route levert de gegevens, dit maakt de tekst.

import { verschuifDag } from "./datum.js";
import { maandagVan } from "./planning.js";

export interface AgendaTraining {
  weekdag: number;
  tijd: string;
  schemaId: string;
  naam: string;
  minuten: number;
  oefeningen: string[];
}

/** Een losse duursessie op een datum (het duurschema verandert per week, dus geen herhaling). */
export interface AgendaDuur {
  datum: string;
  tijd: string;
  titel: string;
  minuten: number;
  uitleg: string;
}

const BYDAY = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

/** Tekst veilig voor een iCal-waarde: backslash, puntkomma, komma en regeleinden escapen. */
export function ical(tekst: string): string {
  return tekst.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Regels van hoogstens 75 bytes; vervolgregels beginnen met een spatie (RFC 5545 §3.1). */
export function vouw(regel: string): string {
  const bytes = Buffer.from(regel, "utf8");
  if (bytes.length <= 75) return regel;
  const delen: string[] = [];
  let begin = 0;
  let max = 75;
  while (begin < bytes.length) {
    let eind = Math.min(begin + max, bytes.length);
    // Niet midden in een UTF-8-teken knippen.
    while (eind < bytes.length && (bytes[eind] & 0xc0) === 0x80) eind--;
    delen.push(bytes.subarray(begin, eind).toString("utf8"));
    begin = eind;
    max = 74; // de spatie vooraan telt mee
  }
  return delen.join("\r\n ");
}

// Europe/Amsterdam met de vaste EU-regels voor zomertijd, zodat elke agenda dezelfde tijden toont.
const TIJDZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Europe/Amsterdam",
  "BEGIN:DAYLIGHT",
  "TZOFFSETFROM:+0100",
  "TZOFFSETTO:+0200",
  "TZNAME:CEST",
  "DTSTART:19700329T020000",
  "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
  "END:DAYLIGHT",
  "BEGIN:STANDARD",
  "TZOFFSETFROM:+0200",
  "TZOFFSETTO:+0100",
  "TZNAME:CET",
  "DTSTART:19701025T030000",
  "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
  "END:STANDARD",
  "END:VTIMEZONE",
];

const lokaal = (dag: string, tijd: string) => `${dag.replace(/-/g, "")}T${tijd.replace(":", "")}00`;

/**
 * @param dag vandaag (JJJJ-MM-DD): de reeks begint deze week, zodat ook vandaag erin staat
 * @param nu tijdstip voor DTSTAMP
 */
export function maakAgenda(
  trainingen: AgendaTraining[],
  { dag, nu, appUrl, duur = [] }: { dag: string; nu: Date; appUrl: string; duur?: AgendaDuur[] },
): string {
  const stempel = nu.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const maandag = maandagVan(dag);
  const regels = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LuzeX//RSLNT//NL",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:RSLNT trainingen",
    "X-WR-TIMEZONE:Europe/Amsterdam",
    // Hoe vaak een agenda opnieuw mag kijken: een uur. Apple bepaalt het zelf ook nog.
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...TIJDZONE,
  ];
  for (const t of [...trainingen].sort((a, b) => a.weekdag - b.weekdag)) {
    const datum = verschuifDag(maandag, t.weekdag - 1);
    const beschrijving = [...t.oefeningen, "", `Open RSLNT: ${appUrl}`].join("\n");
    regels.push(
      "BEGIN:VEVENT",
      `UID:${t.schemaId}-${t.weekdag}@rslnt`,
      `DTSTAMP:${stempel}`,
      `DTSTART;TZID=Europe/Amsterdam:${lokaal(datum, t.tijd)}`,
      `DURATION:PT${Math.max(15, Math.round(t.minuten))}M`,
      `RRULE:FREQ=WEEKLY;BYDAY=${BYDAY[t.weekdag - 1]}`,
      `SUMMARY:${ical(`Training: ${t.naam}`)}`,
      `DESCRIPTION:${ical(beschrijving)}`,
      `URL:${appUrl}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${ical(`Straks: ${t.naam}`)}`,
      "TRIGGER:-PT30M",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  for (const d of [...duur].sort((a, b) => a.datum.localeCompare(b.datum))) {
    regels.push(
      "BEGIN:VEVENT",
      `UID:duur-${d.datum}@rslnt`,
      `DTSTAMP:${stempel}`,
      `DTSTART;TZID=Europe/Amsterdam:${lokaal(d.datum, d.tijd)}`,
      `DURATION:PT${Math.max(10, Math.round(d.minuten))}M`,
      `SUMMARY:${ical(d.titel)}`,
      `DESCRIPTION:${ical(`${d.uitleg}\n\nOpen RSLNT: ${appUrl}`)}`,
      `URL:${appUrl}`,
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${ical(`Straks: ${d.titel}`)}`,
      "TRIGGER:-PT30M",
      "END:VALARM",
      "END:VEVENT",
    );
  }
  regels.push("END:VCALENDAR");
  return regels.map(vouw).join("\r\n") + "\r\n";
}
