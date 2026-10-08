// De eerste stappen van een nieuw account: (1) een paar gegevens over jou, (2) je schema. Gratis is
// dat het standaardschema (2, 3 of 4 dagen); met Pro kan het ook op maat. Via ?stap=2 (vanaf
// Schema) kies je later een ander aantal dagen.

const naarStap2 = queryParam("stap") === "2";
let geslacht = null;
let dagen = 3;
const groep = document.getElementById("keuze-geslacht");
const dagenGroep = document.getElementById("keuze-dagen");

function kiesUit(houder, knop) {
  for (const k of houder.querySelectorAll(".keuze")) k.setAttribute("aria-checked", String(k === knop));
}

groep.addEventListener("click", (e) => {
  const knop = e.target.closest("[data-waarde]");
  if (!knop) return;
  geslacht = knop.dataset.waarde || null;
  kiesUit(groep, knop);
});

dagenGroep.addEventListener("click", (e) => {
  const knop = e.target.closest("[data-dagen]");
  if (!knop) return;
  dagen = Number(knop.dataset.dagen);
  kiesUit(dagenGroep, knop);
});

function toonStap2(gebruiker) {
  document.getElementById("start-form").hidden = true;
  document.getElementById("stap-schema").hidden = false;
  document.getElementById("stap").textContent = naarStap2 ? "Schema" : "Stap 2 van 2";
  document.getElementById("kop").textContent = "Je schema";
  document.getElementById("uitleg").textContent = naarStap2
    ? "Kies hoe vaak je traint. Een ander aantal dagen werkt je standaardschema bij; je geschiedenis blijft."
    : "Kies hoe vaak je traint, dan staat je eerste training klaar.";
  const opMaat = document.getElementById("op-maat");
  if (gebruiker?.pro) {
    opMaat.href = naarStap2 ? "/personaliseren.html" : "/personaliseren.html?start=1";
    opMaat.textContent = "Schema op maat";
  } else {
    opMaat.href = "/pro.html";
    opMaat.textContent = "Schema op maat met Pro";
  }
}

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
    toonStap2(await haalSessie());
    window.scrollTo({ top: 0 });
  } catch (f) {
    fout.textContent = foutTekst(f);
  } finally {
    knop.disabled = false;
  }
});

document.getElementById("standaard").addEventListener("click", async () => {
  const knop = document.getElementById("standaard");
  const fout = document.getElementById("standaard-fout");
  fout.textContent = "";
  knop.disabled = true;
  try {
    await api("/api/standaardschema", { methode: "POST", body: { dagenPerWeek: dagen } });
    window.location.href = "/";
  } catch (f) {
    fout.textContent = foutTekst(f);
    knop.disabled = false;
  }
});

vereisSessie().then(async (g) => {
  if (g.offline) return;
  if (naarStap2) {
    toonStap2(g);
    return;
  }
  document.getElementById("kop").textContent = `Welkom, ${g.naam}`;
  try {
    // Wie al een schema heeft, hoort niet in de eerste stap.
    const { programmas } = await api("/api/programmas");
    if (programmas.some((p) => p.actief)) window.location.replace("/");
  } catch {
    // geen verbinding: gewoon het formulier laten zien
  }
});
