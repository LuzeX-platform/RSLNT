// Duurtraining (Pro): hardlopen, fietsen … naast je krachttraining. Zonder Pro zie je wat het is.

let gegevens = null;

function vandaagDag() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

function kmTekst(meter) {
  return meter === null ? "" : `${getal(meter / 1000, 2)} km`;
}

function teken() {
  const { duurtrainingen, week, soorten, intensiteiten } = gegevens;
  document.getElementById("week").innerHTML = `
    <div><div class="getal-groot">${week.minuten}</div><div class="getal-label">minuten</div></div>
    <div><div class="getal-groot">${week.sessies}</div><div class="getal-label">${week.sessies === 1 ? "training" : "trainingen"}</div></div>
    <div><div class="getal-groot">${week.zwaar}</div><div class="getal-label">zwaar voor je benen</div></div>`;
  const lijst = document.getElementById("lijst");
  lijst.innerHTML = duurtrainingen.length
    ? duurtrainingen
        .map(
          (d) => `
        <li class="lijst-rij">
          <span><strong>${escapeHtml(soorten[d.soort] ?? d.soort)} · ${d.minuten} min${d.afstandMeter !== null ? ` · ${kmTekst(d.afstandMeter)}` : ""}</strong><br />
          <span class="lijst-meta">${dagKort(d.datum)} · ${escapeHtml((intensiteiten[d.intensiteit] ?? d.intensiteit).split(" (")[0])}${d.notitie ? ` · ${escapeHtml(d.notitie)}` : ""}</span></span>
          <button type="button" class="text-link gevaar-link" data-weg="${escapeHtml(d.id)}" aria-label="Verwijderen">Wis</button>
        </li>`,
        )
        .join("")
    : '<li class="lijst-meta">Nog geen duurtrainingen.</li>';
}

async function laadMeldingen() {
  // Het advies hoort bij Vandaag (je volgende krachttraining); hier dezelfde meldingen.
  try {
    const { hybride } = await api("/api/pro/vandaag");
    document.getElementById("meldingen").innerHTML = hybride.meldingen.map((m) => `<p class="melding ruimte-boven">${escapeHtml(m)}</p>`).join("");
  } catch {
    document.getElementById("meldingen").innerHTML = "";
  }
}

async function laad() {
  gegevens = await api("/api/pro/duur");
  teken();
  laadMeldingen();
}

document.getElementById("duur-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fout = document.getElementById("fout");
  fout.textContent = "";
  const minuten = leesGetal(document.getElementById("minuten").value);
  const afstand = leesGetal(document.getElementById("afstand").value);
  if (minuten === null || minuten < 1 || !Number.isInteger(minuten)) {
    fout.textContent = "Vul het aantal minuten in, bijvoorbeeld 45.";
    return;
  }
  try {
    await api("/api/pro/duur", {
      methode: "POST",
      body: {
        datum: document.getElementById("datum").value,
        soort: document.getElementById("soort").value,
        minuten,
        afstandKm: afstand,
        intensiteit: document.getElementById("intensiteit").value,
        notitie: document.getElementById("notitie").value.trim(),
      },
    });
    for (const id of ["minuten", "afstand", "notitie"]) document.getElementById(id).value = "";
    await laad();
  } catch (f) {
    fout.textContent = foutTekst(f);
  }
});

document.getElementById("lijst").addEventListener("click", async (e) => {
  const knop = e.target.closest("[data-weg]");
  if (!knop || !confirm("Deze duurtraining verwijderen?")) return;
  try {
    await api(`/api/pro/duur/${encodeURIComponent(knop.dataset.weg)}`, { methode: "DELETE" });
    await laad();
  } catch (f) {
    document.getElementById("fout").textContent = foutTekst(f);
  }
});

vereisSessie().then(async (g) => {
  if (g.offline) return;
  if (!g.pro) {
    toonProSlot(
      document.getElementById("pro-slot"),
      "Hybride trainen",
      "Loop, fiets of zwem je naast je krachttraining? Met Pro log je dat hier, en houdt RSLNT er rekening mee.",
      ["hybride"],
    );
    return;
  }
  document.getElementById("pro-inhoud").hidden = false;
  const datum = document.getElementById("datum");
  datum.value = vandaagDag();
  datum.max = vandaagDag();
  try {
    await laad();
    document.getElementById("soort").innerHTML = Object.entries(gegevens.soorten).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join("");
    document.getElementById("intensiteit").innerHTML = Object.entries(gegevens.intensiteiten).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join("");
  } catch (f) {
    document.getElementById("fout").textContent = foutTekst(f);
  }
});
