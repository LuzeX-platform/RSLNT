// Upgraden naar Pro en je abonnement beheren. Beide knoppen sturen je naar een door Stripe
// gehoste pagina (Checkout resp. Billing Portal) — er draait hier geen Stripe.js, alleen een
// redirect, zie routes/abonnement.ts.

vereisSessie().then((g) => {
  if (g.offline) return;
  const afgerekend = queryParam("afgerekend") === "1";
  document.getElementById("afgerekend-melding").hidden = !afgerekend || g.pro;
  document.getElementById("status-paneel").hidden = !g.pro;
  document.getElementById("upgrade-paneel").hidden = g.pro;
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
