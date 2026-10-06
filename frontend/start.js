// De eerste stap na het bevestigen van je account: een paar gegevens over jou, daarna het schema
// op maat (personaliseren.html?start=1). Wie al een programma heeft, hoort hier niet.

let geslacht = null;
const groep = document.getElementById("keuze-geslacht");

groep.addEventListener("click", (e) => {
  const knop = e.target.closest("[data-waarde]");
  if (!knop) return;
  geslacht = knop.dataset.waarde || null;
  for (const k of groep.querySelectorAll("[data-waarde]")) k.setAttribute("aria-checked", String(k === knop));
});

document.getElementById("start-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fout = document.getElementById("fout");
  const knop = document.getElementById("verder");
  fout.textContent = "";
  const lengteTekst = document.getElementById("lengte").value.trim();
  const gewichtTekst = document.getElementById("gewicht").value.trim();
  const lengteCm = leesGetal(lengteTekst);
  const gewicht = leesGetal(gewichtTekst);
  if (lengteTekst && (lengteCm === null || lengteCm < 100 || lengteCm > 250)) {
    fout.textContent = "Lengte: vul centimeters in, bijvoorbeeld 180.";
    return;
  }
  if (gewichtTekst && (gewicht === null || gewicht < 30 || gewicht > 300)) {
    fout.textContent = "Gewicht: vul kilo's in, bijvoorbeeld 75,4.";
    return;
  }
  knop.disabled = true;
  try {
    const geboortedatum = document.getElementById("geboortedatum").value || null;
    await api("/api/profiel", { methode: "PUT", body: { geslacht, geboortedatum, lengteCm } });
    if (gewicht !== null) {
      const vandaag = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
      await api(`/api/lichaamsgewicht/${vandaag}`, { methode: "PUT", body: { gewicht } });
    }
    window.location.href = "/personaliseren.html?start=1";
  } catch (f) {
    fout.textContent = foutTekst(f);
  } finally {
    knop.disabled = false;
  }
});

vereisSessie().then(async (g) => {
  if (g.offline) return;
  document.getElementById("kop").textContent = `Welkom, ${g.naam}`;
  try {
    const { programmas } = await api("/api/programmas");
    if (programmas.some((p) => p.actief)) window.location.replace("/");
  } catch {
    // geen verbinding: gewoon het formulier laten zien
  }
});
