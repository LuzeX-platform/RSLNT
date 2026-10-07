// Kruisproduct-Pro v2: een actief, betalend ACCRD-account geeft gratis Pro op RSLNT, mits de
// klant zijn kvk-nummer zelf invult (zie routes/kruisproduct.ts). Vervangt het oudere, op
// e-mailadres gebaseerde mechanisme (het vorige luzexEntitlement.ts, dat ook SCRNN meetelde en
// automatisch toekende bij e-mailbevestiging): SCRNN telt hier bewust niet meer mee — dit is
// uitsluitend een ACCRD-voordeel — en toekenning is nooit meer een bijeffect van iets anders,
// altijd een expliciete actie van de klant met zijn kvk-nummer. Zie hub/CLAUDE.md en ACCRD's
// src/routes/luzexIntern.ts voor de volledige afspraak en het exacte contract.
//
// Wie al gratis Pro had via het oude mechanisme verliest die de volgende cron-run: er staat nog
// geen kvk-nummer voor hem vast, en dat is bewust geen migratiefout maar de verwachte overgang
// (zie de opdracht/CLAUDE.md) — hij moet opnieuw claimen met zijn kvk-nummer.

export type ClaimResultaat =
  | { status: "toegekend" }
  | { status: "niet_actief" }
  | { status: "al_gekozen"; huidigeKeuze: "cmmnty" | "rslnt" }
  | { status: "fout" };

function basisUrlEnSleutel(): { basisUrl: string; sleutel: string } | null {
  const basisUrl = process.env.ACCRD_INTERN_URL;
  const sleutel = process.env.LUZEX_INTERN_SLEUTEL;
  if (!basisUrl || !sleutel) return null;
  return { basisUrl: basisUrl.replace(/\/+$/, ""), sleutel };
}

/**
 * Claimt gratis Pro bij ACCRD op basis van een kvk-nummer. Netwerk- of configuratiefouten geven
 * "fout" terug (nooit "toegekend") zodat de aanroepende route dit nooit per ongeluk als succes
 * leest; de aanroeper beslist zelf hoe hij dat aan de klant meldt.
 */
export async function claimKruisproductPro(kvkNummer: string, wisselen?: boolean): Promise<ClaimResultaat> {
  const config = basisUrlEnSleutel();
  if (!config) return { status: "fout" };
  try {
    const response = await fetch(`${config.basisUrl}/api/intern/luzex-kruisproduct-claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Luzex-Intern-Sleutel": config.sleutel },
      body: JSON.stringify({ kvkNummer, product: "rslnt", wisselen }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { status: "fout" };
    return (await response.json()) as ClaimResultaat;
  } catch {
    return { status: "fout" };
  }
}

/** Dagelijkse hercontrole (read-only, voor kruisproductCron.ts): is dit kvk-nummer nog steeds de actieve RSLNT-keuze bij ACCRD? */
export async function controleerKruisproductStatus(kvkNummer: string): Promise<boolean> {
  const config = basisUrlEnSleutel();
  if (!config) return false;
  try {
    const response = await fetch(
      `${config.basisUrl}/api/intern/luzex-kruisproduct-status?kvkNummer=${encodeURIComponent(kvkNummer)}&product=rslnt`,
      { headers: { "X-Luzex-Intern-Sleutel": config.sleutel }, signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) return false;
    const data = (await response.json()) as { actief?: boolean };
    return data.actief === true;
  } catch {
    return false;
  }
}
