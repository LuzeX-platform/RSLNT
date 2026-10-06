// Kalenderdagen als "JJJJ-MM-DD" in Nederlandse tijd. De server draait in UTC (Render), dus
// "vandaag" moet expliciet in Europe/Amsterdam: anders valt een weging om 00:30 op gisteren.

export const TIJDZONE = "Europe/Amsterdam";

const DAG = /^\d{4}-\d{2}-\d{2}$/;

export function isDag(waarde: string): boolean {
  if (!DAG.test(waarde)) return false;
  const d = naarDatum(waarde);
  return !Number.isNaN(d.getTime()) && uitDatum(d) === waarde;
}

export function vandaag(nu: Date = new Date()): string {
  // en-CA geeft precies JJJJ-MM-DD.
  return nu.toLocaleDateString("en-CA", { timeZone: TIJDZONE });
}

/** "JJJJ-MM-DD" → Date op middernacht UTC (zo bewaart Prisma een @db.Date). */
export function naarDatum(dag: string): Date {
  return new Date(`${dag}T00:00:00.000Z`);
}

export function uitDatum(datum: Date): string {
  return datum.toISOString().slice(0, 10);
}

export function verschuifDag(dag: string, dagen: number): string {
  const d = naarDatum(dag);
  d.setUTCDate(d.getUTCDate() + dagen);
  return uitDatum(d);
}
