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

function tekenVolume() {
  const { rijen, referentie, weken: aantal, vanafWeek } = gegevens.volume;
  const getrainde = rijen.filter((r) => r.gemiddeld > 0 || r.dezeWeek > 0);
  document.getElementById("volume-samenvatting").textContent = getrainde.length
    ? `Gemiddeld per week over ${aantal === 1 ? "deze week" : `${aantal} weken (vanaf ${dagKort(vanafWeek)})`}. Hulpspieren tellen voor de helft. De lijn staat bij ${referentie} sets per week.`
    : "Nog geen sets gelogd in deze periode.";
  staafGrafiek(
    document.getElementById("volume-grafiek"),
    rijen.map((r) => ({
      label: r.label,
      waarde: r.gemiddeld,
      tooltip: [
        { waarde: `${getal(r.gemiddeld, 1)} sets`, label: "gemiddeld per week" },
        { waarde: `${getal(r.dezeWeek, 1)} sets`, label: "deze week" },
      ],
    })),
    {
      referentie,
      referentieLabel: `${referentie}`,
      formatWaarde: (w) => getal(w, 1),
      label: "Sets per spiergroep per week",
    },
  );
  document.getElementById("volume-tabel").innerHTML = tabelHtml(
    ["Spiergroep", "Gem. per week", "Deze week"],
    rijen.map((r) => [r.label, getal(r.gemiddeld, 1), getal(r.dezeWeek, 1)]),
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

vereisSessie().then(laad);
