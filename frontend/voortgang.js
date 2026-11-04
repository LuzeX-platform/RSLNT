// Het dashboard: gewicht naast je doeltempo, sets per spiergroep, volle trainingen en kracht.
// De periodekeuze bovenaan geldt voor alles op deze pagina.

let gegevens = null;
let weken = 12;
let gekozenOefening = null;

const kgTekst = (w) => `${getal(w, 1)} kg`;

function tekenGewicht() {
  const { reeks, band, doelgewicht } = gegevens.gewicht;
  const houder = document.getElementById("gewicht-grafiek");
  const samenvatting = document.getElementById("gewicht-samenvatting");
  document.getElementById("gewicht-legenda").hidden = reeks.length === 0;
  if (reeks.length === 0) {
    samenvatting.textContent = "Nog geen wegingen in deze periode.";
    houder.replaceChildren();
    document.getElementById("gewicht-tabel").innerHTML = "";
    return;
  }
  const laatste = reeks[reeks.length - 1];
  const startMs = Date.parse(`${band.startDatum}T12:00:00Z`);
  const weekVan = (dag) => (Date.parse(`${dag}T12:00:00Z`) - startMs) / (7 * 86400000);
  const bandOp = (dag) => ({
    dag,
    laag: band.startGewicht + band.tempoMin * weekVan(dag),
    hoog: band.startGewicht + band.tempoMax * weekVan(dag),
  });
  const nu = bandOp(laatste.datum);
  const positie =
    laatste.gemiddelde7 < nu.laag ? "onder je doeltempo" : laatste.gemiddelde7 > nu.hoog ? "boven je doeltempo" : "binnen je doeltempo";
  samenvatting.textContent = `Gemiddeld ${kgTekst(laatste.gemiddelde7)}, ${positie} (+${getal(band.tempoMin, 2)} tot +${getal(band.tempoMax, 2)} kg per week)${doelgewicht ? `. Doel: ${kgTekst(doelgewicht)}.` : "."}`;

  tijdGrafiek(houder, {
    punten: reeks.map((r) => ({ dag: r.datum, y: r.gewicht })),
    lijn: reeks.map((r) => ({ dag: r.datum, y: r.gemiddelde7 })),
    band: [bandOp(band.startDatum), nu],
    formatY: (y) => getal(y, 1),
    label: `Gewicht over ${weken} weken, met 7-daags gemiddelde en doeltempo`,
    tooltip: (dag) => {
      const r = reeks.find((x) => x.datum === dag);
      const b = bandOp(dag);
      return [
        r && { waarde: kgTekst(r.gewicht), label: "weging", sleutel: "punt" },
        r && { waarde: kgTekst(r.gemiddelde7), label: "7-daags gemiddelde", sleutel: "lijn" },
        { waarde: `${getal(b.laag, 1)}–${getal(b.hoog, 1)} kg`, label: "doeltempo", sleutel: "band" },
      ].filter(Boolean);
    },
  });
  document.getElementById("gewicht-tabel").innerHTML = tabelHtml(
    ["Datum", "Weging", "7-daags gem.", "Doeltempo"],
    [...reeks].reverse().map((r) => {
      const b = bandOp(r.datum);
      return [dagKort(r.datum), kgTekst(r.gewicht), kgTekst(r.gemiddelde7), `${getal(b.laag, 1)}–${getal(b.hoog, 1)}`];
    }),
  );
}

/**
 * De staaf is je laatste 7 dagen: na elke training zie je die meteen terug. Het streepje is je
 * gemiddelde per week in de weken daarvoor (pas als die er zijn).
 */
function tekenVolume() {
  const { rijen, referentie, weken: aantal, recentVan, vanaf } = gegevens.volume;
  const getrainde = rijen.filter((r) => r.recent > 0 || (r.gemiddeld ?? 0) > 0);
  const metGemiddelde = aantal > 0;
  document.getElementById("volume-legenda").hidden = getrainde.length === 0;
  document.getElementById("volume-legenda-gemiddeld").hidden = !metGemiddelde;
  const eerder = metGemiddelde ? `, naast je gemiddelde per week in de ${aantal === 1 ? "week" : `${aantal} weken`} daarvoor (vanaf ${dagKort(vanaf)})` : "";
  document.getElementById("volume-samenvatting").textContent = getrainde.length
    ? `Je laatste 7 dagen (${dagKort(recentVan)} t/m vandaag)${eerder}. Hulpspieren tellen voor de helft. De lijn staat bij ${referentie} sets per week.`
    : "Nog geen sets gelogd in deze periode.";
  staafGrafiek(
    document.getElementById("volume-grafiek"),
    rijen.map((r) => ({
      label: r.label,
      waarde: r.recent,
      doel: r.gemiddeld ?? undefined,
      tooltip: [
        { waarde: `${getal(r.recent, 1)} sets`, label: "laatste 7 dagen" },
        ...(r.gemiddeld === null ? [] : [{ waarde: `${getal(r.gemiddeld, 1)} sets`, label: "gemiddeld per week ervoor" }]),
      ],
    })),
    {
      referentie,
      referentieLabel: `${referentie}`,
      formatWaarde: (w) => getal(w, 1),
      label: "Sets per spiergroep in je laatste 7 dagen",
    },
  );
  document.getElementById("volume-tabel").innerHTML = tabelHtml(
    ["Spiergroep", "Laatste 7 dagen", "Gem. per week ervoor"],
    rijen.map((r) => [r.label, getal(r.recent, 1), r.gemiddeld === null ? "–" : getal(r.gemiddeld, 1)]),
  );
}

function tekenPerTraining() {
  const { grens, trainingen } = gegevens.perTraining;
  const vol = trainingen.filter((t) => t.teVol.length > 0);
  document.getElementById("per-training-paneel").hidden = vol.length === 0;
  document.getElementById("per-training-uitleg").textContent = `Boven ongeveer ${grens} sets voor één spier in één training is extra opbrengst niet meer aantoonbaar. Overweeg die sets over meer trainingen te verdelen.`;
  document.getElementById("per-training").innerHTML = vol
    .map(
      (t) => `
      <li class="lijst-rij">
        <span><strong>${escapeHtml(t.code)} · ${escapeHtml(t.naam)}</strong><br />
        <span class="lijst-meta">${t.teVol.map((v) => `${escapeHtml(v.label)}: ${getal(v.sets, 1)} sets`).join(" · ")}</span></span>
      </li>`,
    )
    .join("");
}

function tekenKracht() {
  const select = document.getElementById("oefening-keuze");
  const { oefeningen } = gegevens;
  const samenvatting = document.getElementById("e1rm-samenvatting");
  if (oefeningen.length === 0) {
    select.hidden = true;
    samenvatting.textContent = "Nog geen sets met gewicht gelogd.";
    document.getElementById("e1rm-grafiek").replaceChildren();
    document.getElementById("e1rm-tabel").innerHTML = "";
    return;
  }
  select.hidden = false;
  if (!oefeningen.some((o) => o.id === gekozenOefening)) gekozenOefening = oefeningen[0].id;
  select.innerHTML = oefeningen
    .map((o) => `<option value="${o.id}"${o.id === gekozenOefening ? " selected" : ""}>${escapeHtml(o.naam)}</option>`)
    .join("");
  const o = oefeningen.find((x) => x.id === gekozenOefening);
  const eerste = o.punten[0];
  const laatste = o.punten[o.punten.length - 1];
  const verschil = laatste.e1rm - eerste.e1rm;
  samenvatting.textContent =
    o.punten.length > 1
      ? `Nu ${kgTekst(laatste.e1rm)}, ${verschil >= 0 ? "+" : ""}${getal(verschil, 1)} kg sinds ${dagKort(eerste.datum)}.`
      : `${kgTekst(laatste.e1rm)} op ${dagKort(laatste.datum)}. Na een paar trainingen zie je hier een lijn.`;
  tijdGrafiek(document.getElementById("e1rm-grafiek"), {
    lijn: o.punten.map((p) => ({ dag: p.datum, y: p.e1rm })),
    punten: o.punten.map((p) => ({ dag: p.datum, y: p.e1rm })),
    formatY: (y) => getal(y, 0),
    label: `Geschatte 1RM van ${o.naam}`,
    tooltip: (dag) => {
      const p = o.punten.find((x) => x.datum === dag);
      return p ? [{ waarde: kgTekst(p.e1rm), label: "geschatte 1RM", sleutel: "lijn" }] : [];
    },
  });
  document.getElementById("e1rm-tabel").innerHTML = tabelHtml(
    ["Datum", "Geschatte 1RM"],
    [...o.punten].reverse().map((p) => [dagKort(p.datum), kgTekst(p.e1rm)]),
  );
}

function tekenRecords() {
  const lijst = document.getElementById("records");
  lijst.innerHTML = gegevens.oefeningen.length
    ? [...gegevens.oefeningen]
        .sort((a, b) => b.record.e1rm - a.record.e1rm)
        .map(
          (o) => `
          <li class="lijst-rij">
            <span><strong>${escapeHtml(o.naam)}</strong><br /><span class="lijst-meta">${dagKort(o.record.datum)}</span></span>
            <strong>${kgTekst(o.record.e1rm)}</strong>
          </li>`,
        )
        .join("")
    : '<li class="lijst-meta">Nog geen records.</li>';
}

function tekenAlles() {
  tekenGewicht();
  tekenVolume();
  tekenPerTraining();
  tekenKracht();
  tekenRecords();
}

async function laad() {
  try {
    document.querySelector("main").classList.add("laden");
    gegevens = await api(`/api/voortgang?weken=${weken}`);
    tekenAlles();
  } catch (fout) {
    document.getElementById("gewicht-samenvatting").textContent = foutTekst(fout);
  } finally {
    document.querySelector("main").classList.remove("laden");
  }
}

document.getElementById("periode").addEventListener("click", (e) => {
  const knop = e.target.closest("[data-weken]");
  if (!knop) return;
  weken = Number(knop.dataset.weken);
  document.querySelectorAll("#periode button").forEach((b) => b.setAttribute("aria-pressed", String(b === knop)));
  laad();
});

document.getElementById("oefening-keuze").addEventListener("change", (e) => {
  gekozenOefening = e.target.value;
  tekenKracht();
});

bijBreedteWijziging(() => gegevens && tekenAlles());

// ---------- Pro ----------

let analyse = null;
let proOefening = null;
const RICHTING_TEKST = { op: "↑ meer", af: "↓ minder", gelijk: "= gelijk" };

function tekenProKracht() {
  const select = document.getElementById("pro-oefening");
  const inhoud = document.getElementById("pro-kracht-inhoud");
  if (!analyse.oefeningen.length) {
    select.hidden = true;
    inhoud.innerHTML = '<p class="lijst-meta ruimte-boven">Nog geen sets met gewicht gelogd.</p>';
    return;
  }
  select.hidden = false;
  if (!analyse.oefeningen.some((o) => o.id === proOefening)) proOefening = analyse.oefeningen[0].id;
  select.innerHTML = analyse.oefeningen
    .map((o) => `<option value="${o.id}"${o.id === proOefening ? " selected" : ""}>${escapeHtml(o.naam)}</option>`)
    .join("");
  const o = analyse.oefeningen.find((x) => x.id === proOefening);
  const t = o.trend;
  const tempo = t
    ? `${t.kgPerWeek >= 0 ? "+" : ""}${getal(t.kgPerWeek, 2)} kg`
    : "–";
  const getallen = `
    <div class="getallen ruimte-boven">
      <div><div class="getal-groot">${kgTekst(o.e1rm)}</div><div class="getal-label">geschatte 1RM nu</div></div>
      <div><div class="getal-groot">${tempo}</div><div class="getal-label">per week${t ? ` (${t.procentPerMaand >= 0 ? "+" : ""}${getal(t.procentPerMaand, 1)}% per maand)` : ""}</div></div>
    </div>`;
  const voorspelling = !t
    ? '<p class="lijst-meta ruimte-boven">Een tempo zie je na minstens 3 trainingen, verspreid over 2 weken of meer, in de laatste 8 weken.</p>'
    : t.over4Weken === null
      ? '<p class="lijst-meta ruimte-boven">Nog één training erbij, dan zie je ook waar je over 4 en 8 weken staat.</p>'
      : `<p class="ruimte-boven">Als het zo doorgaat: <strong>${kgTekst(t.over4Weken)}</strong> over 4 weken, <strong>${kgTekst(t.over8Weken)}</strong> over 8 weken. <span class="lijst-meta">Een lijn door ${t.punten} trainingen, geen belofte.</span></p>`;
  const n = o.niveau;
  const niveau = n
    ? `<p class="ruimte-boven"><strong>${escapeHtml(n.label)}: ${escapeHtml(n.niveauLabel)}</strong> · ${getal(n.verhouding, 2)}× je lichaamsgewicht.${
        n.volgende ? ` Voor ${escapeHtml(n.volgende.label.toLowerCase())}: een 1RM van ${kgTekst(n.volgende.e1rm)} (nog ${kgTekst(Math.max(0, n.volgende.e1rm - o.e1rm))}).` : " Het hoogste niveau."
      }</p>`
    : "";
  const records = o.records.length
    ? `<h3 class="ruimte-boven">Records per aantal reps</h3>${tabelLos(["Reps", "Zwaarste set", "Datum"], o.records.map((r) => [r.reps, kgTekst(r.gewicht), dagKort(r.datum)]))}`
    : "";
  const richt = `<h3 class="ruimte-boven">Richtgewichten</h3><p class="lijst-meta">Met 2 reps over, uit je geschatte 1RM. Handig als je van rep-range wisselt.</p>${tabelLos(
    ["Reps", "Gewicht"],
    o.richtgewichten.map((r) => [r.reps, kgTekst(r.gewicht)]),
  )}`;
  inhoud.innerHTML = getallen + voorspelling + niveau + records + richt;
}

/** Een tabel die meteen zichtbaar is (tabelHtml klapt in, voor onder een grafiek). */
function tabelLos(koppen, rijen) {
  return `<div class="tabel-scroll"><table class="tabel weken-tabel"><thead><tr>${koppen.map((k) => `<th>${escapeHtml(k)}</th>`).join("")}</tr></thead><tbody>${rijen
    .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join("")}</tr>`)
    .join("")}</tbody></table></div>`;
}

function tekenProVolume() {
  const { blokken, zones, rijen } = analyse.volume;
  const zoneLabel = Object.fromEntries(zones.map((z) => [z.zone, z.label]));
  document.getElementById("pro-volume-uitleg").textContent = `Sets per spiergroep per week over 8 weken (hulpspieren half, technieksets half). Zones: ${zones
    .map((z, i) => `${z.label.toLowerCase()} ${i === zones.length - 1 ? `vanaf ${z.vanaf}` : `${z.vanaf}–${zones[i + 1].vanaf}`}`)
    .join(", ")} sets per week.`;
  document.getElementById("pro-volume-inhoud").innerHTML = rijen.length
    ? tabelLos(
        ["Spiergroep", "Gem.", "Zone", "Richting", ...blokken.map((b) => dagKort(b.van).replace(/^\w+ /, ""))],
        rijen.map((r) => [r.label, getal(r.gemiddeld, 1), zoneLabel[r.zone], r.richting ? RICHTING_TEKST[r.richting] : "–", ...r.weken.map((w) => getal(w, 1))]),
      )
    : '<p class="lijst-meta">Nog geen sets in de laatste 8 weken.</p>';
}

async function laadPro(g) {
  if (!g.pro) {
    toonProSlot(
      document.getElementById("pro-slot"),
      "Meer uit je voortgang",
      "Alles hierboven is gratis. Wil je dieper graven, dan voegt Pro dit toe:",
      ["krachttrend", "niveau", "volume", "delen"],
    );
    return;
  }
  try {
    analyse = await api("/api/pro/analyse");
    document.getElementById("pro-kracht").hidden = false;
    document.getElementById("pro-volume").hidden = false;
    tekenProKracht();
    tekenProVolume();
  } catch {
    // Geen verbinding: de rest van de pagina werkt gewoon.
  }
}

document.getElementById("pro-oefening").addEventListener("change", (e) => {
  proOefening = e.target.value;
  tekenProKracht();
});

vereisSessie().then((g) => {
  laad();
  if (!g.offline) laadPro(g);
});
