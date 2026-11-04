// Periodisering in blokken (Pro): een plan voor je actieve programma kiezen, zien en stoppen.

let gegevens = null;
let doel = "kracht";

function tekenPlan() {
  const { plan, blok, soorten, programma } = gegevens;
  const paneel = document.getElementById("plan-paneel");
  paneel.hidden = !plan;
  document.getElementById("kies-titel").textContent = plan ? "Ander plan" : "Kies een plan";
  if (!programma) {
    document.getElementById("kies-uitleg").innerHTML = 'Je hebt nog geen actief programma. Kies eerst een schema onder <a href="/schema.html">Schema</a>.';
    document.getElementById("plan-form").hidden = true;
    return;
  }
  if (!plan) return;
  const sjabloon = gegevens.sjablonen.find((s) => s.doel === plan.doel);
  document.getElementById("plan-titel").textContent = sjabloon?.label ?? "Je plan";
  document.getElementById("plan-samenvatting").textContent = blok
    ? `Week ${blok.week} van ${blok.totaalWeken}: ${blok.label}, week ${blok.weekInBlok} van ${blok.wekenInBlok}. Tot en met ${dagKort(plan.einde)}.`
    : plan.start > gegevens.vandaag
      ? `Begint ${dagKort(plan.start)}, ${plan.totaalWeken} weken, tot en met ${dagKort(plan.einde)}.`
      : `Afgelopen op ${dagKort(plan.einde)}. Kies hieronder een nieuw plan, of stop.`;
  let week = 0;
  document.getElementById("tijdlijn").innerHTML = plan.blokken
    .flatMap((b) =>
      Array.from({ length: b.weken }, () => {
        week += 1;
        return `<div class="blok-week${blok && blok.week === week ? " nu" : ""}" title="Week ${week}: ${escapeHtml(soorten[b.soort].label)}">${soorten[b.soort].label.slice(0, 1)}</div>`;
      }),
    )
    .join("");
  document.getElementById("legenda").innerHTML = plan.blokken
    .map((b) => `<li><strong>${escapeHtml(soorten[b.soort].label)}</strong> · ${b.weken} ${b.weken === 1 ? "week" : "weken"}<br /><span class="lijst-meta">${escapeHtml(soorten[b.soort].uitleg)}</span></li>`)
    .join("");
}

function tekenKeuze() {
  document.getElementById("doelen").innerHTML = gegevens.sjablonen
    .map((s) => `<button type="button" class="keuze" role="radio" data-doel="${s.doel}" aria-checked="${s.doel === doel}" aria-pressed="${s.doel === doel}">${escapeHtml(s.label)}</button>`)
    .join("");
  const s = gegevens.sjablonen.find((x) => x.doel === doel);
  document.getElementById("sjabloon-uitleg").innerHTML = `
    <p class="subtitle ruimte-boven">${s.weken} weken: ${s.blokken.map((b) => `${escapeHtml(gegevens.soorten[b.soort].label.toLowerCase())} (${b.weken})`).join(", ")}.</p>
    <ul class="blok-legenda">${s.blokken.map((b) => `<li><strong>${escapeHtml(gegevens.soorten[b.soort].label)}</strong><br /><span class="lijst-meta">${escapeHtml(gegevens.soorten[b.soort].uitleg)}</span></li>`).join("")}</ul>`;
}

document.getElementById("doelen").addEventListener("click", (e) => {
  const knop = e.target.closest("[data-doel]");
  if (!knop) return;
  doel = knop.dataset.doel;
  tekenKeuze();
});

document.getElementById("plan-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fout = document.getElementById("fout");
  fout.textContent = "";
  if (gegevens.plan && !confirm("Je huidige plan vervangen door een nieuw plan?")) return;
  try {
    gegevens = await api("/api/pro/periodisering", { methode: "PUT", body: { doel, start: document.getElementById("start").value } });
    tekenPlan();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (f) {
    fout.textContent = foutTekst(f);
  }
});

document.getElementById("stoppen").addEventListener("click", async () => {
  if (!confirm("Plan stoppen? Je gaat terug naar je gewone schema. Trainingen die je al deed houden hun blok.")) return;
  try {
    gegevens = await api("/api/pro/periodisering", { methode: "DELETE" });
    tekenPlan();
  } catch (f) {
    document.getElementById("stop-fout").textContent = foutTekst(f);
  }
});

vereisSessie().then(async (g) => {
  if (g.offline) return;
  if (!g.pro) {
    toonProSlot(
      document.getElementById("pro-slot"),
      "Periodisering in blokken",
      "Voor wie naar een doel toe traint: een krachtpiek of een periode met extra volume. Je gewone schema en voorstel werken gewoon zonder.",
      ["blokken", "advies"],
    );
    return;
  }
  document.getElementById("pro-inhoud").hidden = false;
  try {
    gegevens = await api("/api/pro/periodisering");
    const start = document.getElementById("start");
    start.value = gegevens.vandaag;
    start.min = gegevens.vandaag;
    if (gegevens.plan) doel = gegevens.plan.doel;
    tekenKeuze();
    tekenPlan();
  } catch (f) {
    document.getElementById("fout").textContent = foutTekst(f);
  }
});
