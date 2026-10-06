const formulier = document.getElementById("wachtwoord-form");
const foutEl = document.getElementById("fout");
const succesEl = document.getElementById("succes");

vereisSessie().then((g) => {
  if (g.offline) return;
  document.getElementById("kop").textContent = g.naam;
  document.getElementById("email").textContent = g.email;
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
    succesEl.textContent = "Wachtwoord gewijzigd.";
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
});

document.getElementById("uitloggen").addEventListener("click", uitloggen);
