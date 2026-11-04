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
export async function claimKruisproductPro(kvkNummer: string, code: string, wisselen?: boolean): Promise<ClaimResultaat> {
  const config = basisUrlEnSleutel();
  if (!config) return { status: "fout" };
  try {
    const response = await fetch(`${config.basisUrl}/api/intern/luzex-kruisproduct-claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Luzex-Intern-Sleutel": config.sleutel },
      // De koppelcode uit ACCRD: het KvK-nummer alleen is openbaar (zie kruisproductCode.ts in ACCRD).
      body: JSON.stringify({ kvkNummer, code, product: "rslnt", wisselen }),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return { status: "fout" };
    return (await response.json()) as ClaimResultaat;
  } catch {
    return { status: "fout" };
  }
}

/**
 * Dagelijkse hercontrole (read-only, voor kruisproductCron.ts): is dit kvk-nummer nog steeds de
 * actieve RSLNT-keuze bij ACCRD? `null` betekent "kon niet gecontroleerd worden" (geen config,
 * netwerkfout, ACCRD plat) — niet hetzelfde als een bevestigd "nee". render.yaml's eigen
 * commentaar zegt al "ontbreekt de URL, dan doet dit product gewoon niet mee — niets gaat stuk";
 * dat gold hier alleen op papier zolang dit `false` teruggaf, want de cron zou dat lezen als
 * "niet actief" en bij elke storing bij ACCRD in één klap ieders gratis Pro intrekken. De
 * aanroeper (kruisproductCron.ts) moet `null` dus overslaan, niet intrekken.
 */
export async function controleerKruisproductStatus(kvkNummer: string): Promise<boolean | null> {
  const config = basisUrlEnSleutel();
  if (!config) return null;
  try {
    const response = await fetch(
      `${config.basisUrl}/api/intern/luzex-kruisproduct-status?kvkNummer=${encodeURIComponent(kvkNummer)}&product=rslnt`,
      { headers: { "X-Luzex-Intern-Sleutel": config.sleutel }, signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) return null;
    const data = (await response.json()) as { actief?: boolean };
    return data.actief === true;
  } catch {
    return null;
  }
}

/**
 * Een KvK-nummer zoals de klant het typt ("1234 5678", "12.34.56.78") terug naar de vorm waarin
 * ACCRD het bewaart: acht cijfers, of bij een buitenlands Tax-ID letters, cijfers en streepjes.
 * ACCRD herkent de varianten zelf ook (kvkVarianten() in luzexIntern.ts), maar hier opgeschoond
 * bewaren houdt kruisproductKvkNummer uniek per bedrijf, wat de klant er ook van maakte.
 */
export function schoonKvkNummer(invoer: string): string {
  const zonderSpatiesEnPunten = invoer.trim().replace(/[\s.]/g, "");
  const alleenCijfers = zonderSpatiesEnPunten.replace(/\D/g, "");
  return /^\d{8}$/.test(alleenCijfers) && /^[\d-]+$/.test(zonderSpatiesEnPunten) ? alleenCijfers : zonderSpatiesEnPunten;
}

// --- "Koppel met ACCRD" ---------------------------------------------------------------------
// De knop in plaats van KvK-nummer en koppelcode overtypen (zie ACCRD's
// routes/kruisproductKoppelen.ts). De klant geeft in ACCRD toestemming; ACCRD stuurt hem met een
// eenmalig token terug, en dat token wisselen we hier server-naar-server in. De state bindt het
// token aan de browsersessie waarin de koppeling begon: zonder die controle kan iemand een eigen
// token in andermans sessie laten inwisselen. Zelfde code als in CMMNTY, met "rslnt".

export type InwisselResultaat =
  | { status: "toegekend"; kvkNummer: string }
  | { status: "niet_actief" }
  | { status: "ongeldig" }
  | { status: "al_gekozen"; huidigeKeuze: "cmmnty" | "rslnt" }
  | { status: "fout" };

/** Waar de knop naartoe gaat, of null als ACCRD hier niet ingesteld is (dan geen knop). Zelfde
 *  ACCRD_INTERN_URL als de server-naar-server-aanroepen: in productie is dat het publieke
 *  adres van ACCRD, dus een tweede variabele zou alleen een kans op verschil toevoegen. */
export function accrdKoppelUrl(state: string): string | null {
  const config = basisUrlEnSleutel();
  if (!config) return null;
  return `${config.basisUrl}/kruisproduct-koppelen.html?product=rslnt&state=${encodeURIComponent(state)}`;
}

export async function wisselKoppeltokenIn(token: string, state: string): Promise<InwisselResultaat> {
  const config = basisUrlEnSleutel();
  if (!config) return { status: "fout" };
  try {
    const response = await fetch(`${config.basisUrl}/api/intern/luzex-kruisproduct-inwisselen`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Luzex-Intern-Sleutel": config.sleutel },
      body: JSON.stringify({ token, state, product: "rslnt" }),
      signal: AbortSignal.timeout(5000),
    });
    if (response.status === 400) return { status: "ongeldig" };
    if (!response.ok) return { status: "fout" };
    return (await response.json()) as InwisselResultaat;
  } catch {
    return { status: "fout" };
  }
}
