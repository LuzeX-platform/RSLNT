// Lichaamsgewicht: wegen, en de lijst met het 7-daags gemiddelde. De grafiek met de doelband
// (+0,25–0,5 kg per week) komt in fase 2.

const datumEl = document.getElementById("datum");
const gewichtEl = document.getElementById("gewicht");
const foutEl = document.getElementById("fout");
let gegevens = null;

function teken() {
  const { metingen, gemiddelde7, vandaag } = gegevens;
  document.getElementById("gemiddelde").textContent = gemiddelde7 === null ? "–" : kg(gemiddelde7, 1);

  // Verschil van het gemiddelde nu met het gemiddelde van een week eerder: dat is je tempo per week.
  const weekTerug = metingen.find((m) => m.datum <= verschuif(vandaag, -7));
  const verschil = gemiddelde7 !== null && weekTerug ? gemiddelde7 - weekTerug.gemiddelde7 : null;
  document.getElementById("verschil").textContent =
    verschil === null ? "–" : `${verschil > 0 ? "+" : ""}${getal(verschil, 1)} kg`;

  const lijst = document.getElementById("metingen");
  lijst.innerHTML = metingen.length
    ? metingen
        .map(
          (m) => `
          <li class="lijst-rij">
            <span><strong>${kg(m.gewicht, 1)}</strong><br /><span class="lijst-meta">${dagKort(m.datum)} · gem. ${kg(m.gemiddelde7, 1)}</span></span>
            <button type="button" class="text-link gevaar-link" data-datum="${m.datum}" aria-label="Weging van ${dagKort(m.datum)} verwijderen">Wis</button>
          </li>`,
        )
        .join("")
    : '<li class="lijst-meta">Nog geen wegingen.</li>';
}

/** Kalenderdag verschuiven, in de browser (de server doet hetzelfde in datum.ts). */
function verschuif(dag, dagen) {
  const d = new Date(`${dag}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + dagen);
  return d.toISOString().slice(0, 10);
}

async function laad() {
  await vereisSessie();
  try {
    gegevens = await api("/api/lichaamsgewicht?dagen=90");
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
    return;
  }
  if (!datumEl.value) datumEl.value = gegevens.vandaag;
  datumEl.max = gegevens.vandaag;
  teken();
}

document.getElementById("gewicht-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  foutEl.textContent = "";
  const waarde = leesGetal(gewichtEl.value);
  if (!datumEl.value || waarde === null) {
    foutEl.textContent = "Vul een datum en je gewicht in.";
    return;
  }
  try {
    await api(`/api/lichaamsgewicht/${datumEl.value}`, { methode: "PUT", body: { gewicht: waarde } });
    gewichtEl.value = "";
    await laad();
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
});

document.getElementById("metingen").addEventListener("click", async (e) => {
  const knop = e.target.closest("[data-datum]");
  if (!knop || !confirm(`Weging van ${dagKort(knop.dataset.datum)} verwijderen?`)) return;
  try {
    await api(`/api/lichaamsgewicht/${knop.dataset.datum}`, { methode: "DELETE" });
    await laad();
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
});

laad();
