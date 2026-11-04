// Pijnlogboek (Pro): pijn per plek per week, bij welke oefeningen, en je eigen notities.

let weken = 12;
let ernst = null;

function vandaagDag() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" });
}

const RICHTING = { beter: "minder dan de 2 weken ervoor", slechter: "meer dan de 2 weken ervoor", gelijk: "ongeveer als de 2 weken ervoor" };

function plekHtml(p, vanaf) {
  const weekKoppen = p.perWeek.map((_, i) => {
    const van = new Date(`${vanaf}T12:00:00`);
    van.setDate(van.getDate() + i * 7);
    return van.toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
  });
  const ingevuld = p.perWeek.filter((w) => w !== null).length;
  return `
    <section class="panel">
      <div class="panel-kop"><h2>${escapeHtml(p.label)}</h2>${p.richting ? `<span class="badge">${escapeHtml(RICHTING[p.richting])}</span>` : ""}</div>
      <p class="subtitle">Laatst ${dagKort(p.laatst)}. ${ingevuld ? `In ${ingevuld} van de ${p.perWeek.length} weken pijn bij een set.` : "Geen pijn bij een set."}${p.checkDagen ? ` ${p.checkDagen} keer in je herstelcheck.` : ""}</p>
      ${
        ingevuld
          ? `<div class="tabel-scroll"><table class="tabel weken-tabel"><thead><tr><th>Week van</th>${weekKoppen.map((k) => `<th>${k}</th>`).join("")}</tr></thead>
             <tbody><tr><td>Hoogste pijn</td>${p.perWeek.map((w) => `<td>${w === null ? "–" : w}</td>`).join("")}</tr></tbody></table></div>`
          : ""
      }
      ${
        p.oefeningen.length
          ? `<h3 class="ruimte-boven">Bij welke oefeningen</h3><ul class="lijst">${p.oefeningen
              .map(
                (o) => `<li class="lijst-rij"><span><strong>${escapeHtml(o.naam)}</strong><br /><span class="lijst-meta">${o.keer} ${o.keer === 1 ? "set" : "sets"}, laatst ${dagKort(o.laatst)}</span></span><strong>max ${o.max}</strong></li>`,
              )
              .join("")}</ul>`
          : ""
      }
    </section>`;
}

function tekenNotities(notities) {
  document.getElementById("notities").innerHTML = notities.length
    ? notities
        .map(
          (n) => `
      <li class="lijst-rij">
        <span><strong>${escapeHtml(n.plekLabel)} · ${n.ernst}/10</strong>${n.status === "hersteld" ? ' <span class="badge badge-succes">Hersteld</span>' : ""}<br />
        <span class="lijst-meta">${dagKort(n.datum)}${n.herstelOp ? ` · hersteld ${dagKort(n.herstelOp)}` : ""}${n.notitie ? ` · ${escapeHtml(n.notitie)}` : ""}</span></span>
        <button type="button" class="text-link" data-notitie="${escapeHtml(n.id)}" data-status="${n.status === "hersteld" ? "actief" : "hersteld"}">${n.status === "hersteld" ? "Weer actief" : "Hersteld"}</button>
      </li>`,
        )
        .join("")
    : '<li class="lijst-meta">Nog geen notities.</li>';
}

async function laad() {
  const g = await api(`/api/pro/pijn?weken=${weken}`);
  document.getElementById("plekken").innerHTML = g.plekken.length
    ? g.plekken.map((p) => plekHtml(p, g.vanaf)).join("")
    : `<section class="panel"><p class="subtitle">Geen pijn ingevuld in de laatste ${weken} weken. Fijn zo. Bij een set vul je pijn in met de knop "Pijn?".</p></section>`;
  tekenNotities(g.notities);
  if (!document.getElementById("plek").options.length) {
    document.getElementById("plek").innerHTML = Object.entries(g.plekLabels).map(([k, v]) => `<option value="${k}">${escapeHtml(v)}</option>`).join("");
  }
}

function tekenErnst() {
  document.getElementById("ernst").innerHTML = Array.from({ length: 11 }, (_, i) =>
    `<button type="button" class="keuze${i >= 4 ? " pijn-grens" : ""}" role="radio" data-ernst="${i}" aria-checked="${ernst === i}" aria-pressed="${ernst === i}">${i}</button>`,
  ).join("");
}

document.getElementById("ernst").addEventListener("click", (e) => {
  const knop = e.target.closest("[data-ernst]");
  if (!knop) return;
  ernst = Number(knop.dataset.ernst);
  tekenErnst();
});

document.getElementById("periode").addEventListener("click", (e) => {
  const knop = e.target.closest("[data-weken]");
  if (!knop) return;
  weken = Number(knop.dataset.weken);
  document.querySelectorAll("#periode button").forEach((b) => b.setAttribute("aria-pressed", String(b === knop)));
  laad().catch((f) => (document.getElementById("fout").textContent = foutTekst(f)));
});

document.getElementById("notitie-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fout = document.getElementById("fout");
  fout.textContent = "";
  if (ernst === null) {
    fout.textContent = "Kies hoeveel pijn (0–10).";
    return;
  }
  try {
    await api("/api/pro/pijn/notities", {
      methode: "POST",
      body: { datum: document.getElementById("datum").value, plek: document.getElementById("plek").value, ernst, notitie: document.getElementById("tekst").value.trim() },
    });
    document.getElementById("tekst").value = "";
    ernst = null;
    tekenErnst();
    await laad();
  } catch (f) {
    fout.textContent = foutTekst(f);
  }
});

document.getElementById("notities").addEventListener("click", async (e) => {
  const knop = e.target.closest("[data-notitie]");
  if (!knop) return;
  try {
    await api(`/api/pro/pijn/notities/${encodeURIComponent(knop.dataset.notitie)}`, { methode: "PATCH", body: { status: knop.dataset.status } });
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
      "Pijnlogboek",
      "De pijn die je per set en in je herstelcheck invult, bij elkaar per plek. De pijnregel zelf (10% terug bij pijn) werkt ook zonder Pro.",
      ["pijn", "delen"],
    );
    return;
  }
  document.getElementById("pro-inhoud").hidden = false;
  const datum = document.getElementById("datum");
  datum.value = vandaagDag();
  datum.max = vandaagDag();
  tekenErnst();
  try {
    await laad();
  } catch (f) {
    document.getElementById("fout").textContent = foutTekst(f);
  }
});
