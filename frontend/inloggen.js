const formulier = document.getElementById("formulier");
const foutEl = document.getElementById("fout");

/** Alleen interne paden als terugweg, zodat ?terug= niet naar een andere site kan sturen. */
function veiligTerug() {
  const terug = queryParam("terug");
  return terug && terug.startsWith("/") && !terug.startsWith("//") ? terug : "/";
}

haalSessie().then((g) => {
  if (g && !g.offline) window.location.href = veiligTerug();
});

formulier.addEventListener("submit", async (e) => {
  e.preventDefault();
  const knop = formulier.querySelector('button[type="submit"]');
  foutEl.textContent = "";
  knop.disabled = true;
  try {
    await api("/api/auth/inloggen", {
      methode: "POST",
      body: { email: document.getElementById("email").value.trim(), wachtwoord: document.getElementById("wachtwoord").value },
    });
    window.location.href = veiligTerug();
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  } finally {
    knop.disabled = false;
  }
});
