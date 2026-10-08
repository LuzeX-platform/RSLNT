// Upgraden naar Pro en je abonnement beheren. Beide knoppen sturen je naar een door Stripe
// gehoste pagina (Checkout resp. Billing Portal) — er draait hier geen Stripe.js, alleen een
// redirect, zie routes/abonnement.ts.

vereisSessie().then((g) => {
  if (g.offline) return;
  const afgerekend = queryParam("afgerekend") === "1";
  document.getElementById("afgerekend-melding").hidden = !afgerekend || g.pro;
  document.getElementById("status-paneel").hidden = !g.pro;
  document.getElementById("upgrade-paneel").hidden = g.pro;
  // Alleen zinnig voor wie nog geen Pro heeft: wie al Pro heeft (via Stripe of al via ACCRD)
  // heeft hier niets te claimen.
  document.getElementById("kruisproduct-paneel").hidden = g.pro;
  if (g.pro && g.proBron) {
    document.getElementById("pro-bron-tekst").textContent = `Je hebt gratis Pro via je account bij ${g.proBron === "accrd" ? "ACCRD" : "SCRNN"}.`;
    document.getElementById("beheer-knop").hidden = true;
  } else if (g.pro && g.rol === "admin") {
    document.getElementById("pro-bron-tekst").textContent = "Je bent de eigenaar van RSLNT: altijd Pro, zonder abonnement.";
    document.getElementById("beheer-knop").hidden = true;
  }
});

document.getElementById("upgrade-knop").addEventListener("click", async () => {
  const fout = document.getElementById("upgrade-fout");
  fout.textContent = "";
  try {
    const { url } = await api("/api/abonnement/checkout", { methode: "POST" });
    window.location.href = url;
  } catch (f) {
    fout.textContent = foutTekst(f);
  }
});

document.getElementById("beheer-knop").addEventListener("click", async () => {
  const fout = document.getElementById("beheer-fout");
  fout.textContent = "";
  try {
    const { url } = await api("/api/abonnement/portaal", { methode: "POST" });
    window.location.href = url;
  } catch (f) {
    fout.textContent = foutTekst(f);
  }
});

// Kruisproduct-Pro v2: kvk-nummer claimen bij ACCRD. Bij "al_gekozen" (409) tonen we een
// expliciete wissel-knop in plaats van meteen te wisselen — wisselen is een bewuste actie van de
// klant, nooit een bijeffect van het formulier opnieuw insturen (zie routes/kruisproduct.ts).
let laatstIngevuldKvk = "";

async function verstuurKruisproductClaim(kvkNummer, wisselen) {
  const fout = document.getElementById("kruisproduct-fout");
  const wisselPaneel = document.getElementById("kruisproduct-wisselen");
  fout.textContent = "";
  try {
    await api("/api/account/kruisproduct-claim", { methode: "POST", body: { kvkNummer, wisselen } });
    wisselPaneel.hidden = true;
    window.location.reload();
  } catch (f) {
    if (f.status === 409 && f.data?.errorCode === "AL_GEKOZEN") {
      laatstIngevuldKvk = kvkNummer;
      wisselPaneel.hidden = false;
      return;
    }
    wisselPaneel.hidden = true;
    fout.textContent = foutTekst(f);
  }
}

document.getElementById("kruisproduct-formulier").addEventListener("submit", async (event) => {
  event.preventDefault();
  const kvkNummer = document.getElementById("kvk-invoer").value.trim();
  if (!kvkNummer) return;
  await verstuurKruisproductClaim(kvkNummer, false);
});

document.getElementById("kruisproduct-wisselen-knop").addEventListener("click", async () => {
  if (!laatstIngevuldKvk) return;
  await verstuurKruisproductClaim(laatstIngevuldKvk, true);
});
