// Je account: naam, wachtwoord, je gegevens downloaden, uitloggen en je account verwijderen.

const formulier = document.getElementById("wachtwoord-form");
const foutEl = document.getElementById("fout");
const succesEl = document.getElementById("succes");

vereisSessie().then((g) => {
  if (g.offline) return;
  document.getElementById("kop").textContent = g.naam;
  document.getElementById("email").textContent = g.email;
  document.getElementById("naam").value = g.naam;
  document.getElementById("pro-status").textContent = g.pro ? "Je hebt Pro." : "Geen Pro: het schema op maat en de oefeningenbibliotheek zijn op dit moment niet beschikbaar.";
  // Het eigenaarsaccount beheert de app en kan niet zichzelf verwijderen.
  document.getElementById("verwijder-paneel").hidden = g.rol === "admin";
  document.getElementById("beheer-paneel").hidden = g.rol !== "admin";
});

document.getElementById("naam-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fout = document.getElementById("naam-fout");
  const succes = document.getElementById("naam-succes");
  fout.textContent = "";
  succes.textContent = "";
  const naam = document.getElementById("naam").value.trim();
  try {
    await api("/api/account", { methode: "PUT", body: { naam } });
    document.getElementById("kop").textContent = naam;
    succes.textContent = "Opgeslagen.";
  } catch (f) {
    fout.textContent = foutTekst(f);
  }
});

formulier.addEventListener("submit", async (e) => {
  e.preventDefault();
  foutEl.textContent = "";
  succesEl.textContent = "";
  try {
    await api("/api/auth/wachtwoord", {
      methode: "POST",
      body: { huidig: document.getElementById("huidig").value, nieuw: document.getElementById("nieuw").value },
    });
    formulier.reset();
    succesEl.textContent = "Wachtwoord gewijzigd. Op je andere apparaten ben je uitgelogd.";
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
});

document.getElementById("verwijder-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fout = document.getElementById("verwijder-fout");
  fout.textContent = "";
  if (!confirm("Je account en al je gegevens worden voorgoed verwijderd. Doorgaan?")) return;
  try {
    await api("/api/account", { methode: "DELETE", body: { wachtwoord: document.getElementById("verwijder-wachtwoord").value } });
    try {
      localStorage.clear();
    } catch {
      // geen opslag: niets op te ruimen
    }
    if ("caches" in window) for (const naam of await caches.keys()) await caches.delete(naam);
    window.location.href = "/welkom.html";
  } catch (f) {
    fout.textContent = foutTekst(f);
  }
});

document.getElementById("uitloggen").addEventListener("click", uitloggen);
