// Upgraden naar Pro en je abonnement beheren. Beide knoppen sturen je naar een door Stripe
// gehoste pagina (Checkout resp. Billing Portal) — er draait hier geen Stripe.js, alleen een
// redirect, zie routes/abonnement.ts.

// Pro te koop of niet. Even uit gestaan (november 2026) toen schema op maat en bibliotheek gratis
// werden en Pro nog geen eigen onderdelen had; sinds Pro voor gevorderden weer aan. Uit betekent:
// geen upgradeknop en geen ACCRD-claim; wie al Pro heeft kan zijn abonnement dan nog beheren.
const PRO_IN_VERKOOP = true;

/** De onderdelen uit common.js (PRO_ONDERDELEN); met Pro een link ernaartoe. */
function tekenOnderdelen(pro) {
  document.getElementById("onderdelen-kop").textContent = pro ? "Je Pro-onderdelen" : "Wat je erbij krijgt";
  document.getElementById("onderdelen").innerHTML = PRO_ONDERDELEN.map(
    (o) => `<li${o.nieuw ? ' class="pro-lijst-nieuw"' : ""}><strong>${escapeHtml(o.titel)}</strong>${o.nieuw ? ' <span class="badge">Nieuw</span>' : ""}<span>${escapeHtml(o.tekst)}</span><br />
      ${pro ? `<a class="text-link" href="${o.pad}">Openen</a> · ` : ""}<a class="text-link" href="/wetenschap.html#${o.anker}">Hoe werkt het?</a></li>`,
  ).join("");
}
tekenOnderdelen(false);

vereisSessie().then((g) => {
  if (g.offline) return;
  tekenOnderdelen(g.pro);
  const afgerekend = queryParam("afgerekend") === "1";
  document.getElementById("afgerekend-melding").hidden = !afgerekend || g.pro;
  document.getElementById("status-paneel").hidden = !g.pro;
  document.getElementById("upgrade-paneel").hidden = g.pro;
  document.getElementById("upgrade-knop").hidden = !PRO_IN_VERKOOP;
  // Alleen zinnig voor wie nog geen Pro heeft: wie al Pro heeft (via Stripe of al via ACCRD)
  // heeft hier niets te claimen.
  document.getElementById("kruisproduct-paneel").hidden = g.pro || !PRO_IN_VERKOOP;
  if (g.pro && g.proBron === "handmatig") {
    document.getElementById("pro-bron-tekst").textContent = "Je hebt Pro gekregen van RSLNT. Je betaalt er niets voor.";
    document.getElementById("beheer-knop").hidden = true;
  } else if (g.pro && g.proBron) {
    // "accrd" is de enige bron die nog toegekend wordt. Een oud account kan nog "scrnn" hebben
    // (van voor de archivering van SCRNN); dat noemen we niet meer bij naam, maar het is wel
    // gratis Pro, dus ook daar geen knop om een abonnement te beheren.
    document.getElementById("pro-bron-tekst").textContent =
      g.proBron === "accrd" ? "Je hebt gratis Pro via je ACCRD-account." : "Je hebt gratis Pro via een ander LuzeX-account.";
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
    const code = document.getElementById("code-invoer").value.trim();
    await api("/api/account/kruisproduct-claim", { methode: "POST", body: { kvkNummer, code, wisselen } });
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

// "Koppel met ACCRD": de knop alleen als ACCRD hier ingesteld is. Terug uit ACCRD staan
// accrd_token en state in de URL; die ronden we af en halen we meteen uit de adresbalk, zodat
// een herlaadactie of een gedeelde link het token niet nog eens probeert.
const terugUitAccrd = new URLSearchParams(window.location.search);
if (terugUitAccrd.get("accrd_token") || terugUitAccrd.get("accrd")) history.replaceState(null, "", window.location.pathname);

vereisSessie().then(async (g) => {
  if (g.offline || g.pro || !PRO_IN_VERKOOP) return;
  api("/api/account/kruisproduct-koppelen")
    .then(({ beschikbaar }) => { document.getElementById("koppel-accrd-blok").hidden = !beschikbaar; })
    .catch(() => {});
  const token = terugUitAccrd.get("accrd_token");
  const state = terugUitAccrd.get("state");
  if (!token || !state) return;
  const fout = document.getElementById("kruisproduct-fout");
  try {
    await api("/api/account/kruisproduct-koppelen/afronden", { methode: "POST", body: { token, state } });
    window.location.reload();
  } catch (f) {
    fout.textContent = foutTekst(f);
    document.getElementById("kruisproduct-paneel").scrollIntoView({ block: "center" });
  }
});

document.getElementById("koppel-accrd").addEventListener("click", async (event) => {
  const knop = event.currentTarget;
  const fout = document.getElementById("kruisproduct-fout");
  fout.textContent = "";
  knop.disabled = true;
  try {
    const { url } = await api("/api/account/kruisproduct-koppelen/start", { methode: "POST" });
    window.location.href = url;
  } catch (f) {
    fout.textContent = foutTekst(f);
    knop.disabled = false;
  }
});
