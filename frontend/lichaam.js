// Het gezondheidsmenu: gewicht en tempo naast je doel, samenstelling (BMI, taille/lengte, vet%,
// FFMI), energie en eiwit, metingen en je profiel. Alle berekeningen doet de server
// (backend/src/lichaam.ts); hier alleen tonen en invoeren.

let gegevens = null;

const ONTBREEKT = {
  gewicht: "je gewicht",
  lengte: "je lengte",
  geboortedatum: "je geboortedatum",
  geslacht: "je geslacht",
};

const OORDEEL_KLASSE = { te_langzaam: "badge-bezig", te_snel: "badge-bezig", op_koers: "badge-succes", onbekend: "" };
const OORDEEL_TEKST = { te_langzaam: "Te langzaam", te_snel: "Te snel", op_koers: "Op koers", onbekend: "" };

function waardeRij(label, waarde, toelichting, anker) {
  return `
    <li class="lijst-rij">
      <span><strong>${escapeHtml(label)}</strong><br /><span class="lijst-meta">${toelichting}${anker ? ` <a class="waarom" href="/wetenschap.html#${anker}">Waarom?</a>` : ""}</span></span>
      <strong class="waarde-rechts">${escapeHtml(waarde)}</strong>
    </li>`;
}

function datumLang(dag) {
  return new Date(`${dag}T12:00:00`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
}

function tekenGewicht() {
  const { gewicht, doel } = gegevens;
  document.getElementById("gemiddelde").textContent = gewicht.gemiddelde7 === null ? "–" : kg(gewicht.gemiddelde7, 1);
  document.getElementById("tempo").innerHTML =
    gewicht.trend === null ? "–" : `${gewicht.trend > 0 ? "+" : ""}${getal(gewicht.trend, 2)}<span class="eenheid"> kg/week</span>`;
  const klasse = OORDEEL_KLASSE[gewicht.oordeel];
  document.getElementById("tempo-advies").innerHTML =
    `${klasse ? `<span class="badge ${klasse}">${OORDEEL_TEKST[gewicht.oordeel]}</span> ` : ""}${escapeHtml(gewicht.advies)}` +
    ` <span class="lijst-meta">Doeltempo ${getal(doel.tempoMin, 2)}–${getal(doel.tempoMax, 2)} kg per week${
      gewicht.aanbevolen ? `; onderzoek adviseert ${getal(gewicht.aanbevolen.min, 2)}–${getal(gewicht.aanbevolen.max, 2)}` : ""
    }.</span> <a class="waarom" href="/wetenschap.html#aankomen">Waarom?</a>`;
  const t = gewicht.tijdlijn;
  document.getElementById("tijdlijn").textContent = t
    ? `Nog ${getal(t.nogKg, 1)} kg tot ${getal(doel.gewicht, 1)} kg: tussen ${datumLang(t.vroegst)} en ${datumLang(t.uiterlijk)} (${t.wekenMin}–${t.wekenMax} weken).`
    : doel.gewicht
      ? `Doelgewicht: ${kg(doel.gewicht, 1)}.`
      : "Stel hieronder een doelgewicht in.";
}

function tekenSamenstelling() {
  const s = gegevens.samenstelling;
  const rijen = [];
  if (s.bmi) {
    rijen.push(
      waardeRij("BMI", getal(s.bmi.waarde, 1), `${escapeHtml(s.bmi.categorie)}. Zegt bij veel spiermassa weinig.`, "bmi"),
    );
  }
  if (s.tailleLengte) {
    rijen.push(
      waardeRij(
        "Taille / lengte",
        getal(s.tailleLengte.ratio, 2),
        `${escapeHtml(s.tailleLengte.oordeel)} (onder 0,5 is het advies), gemeten ${dagKort(s.tailleLengte.datum)}`,
        "taille-lengte",
      ),
    );
  }
  if (s.vet) {
    rijen.push(
      waardeRij(
        "Vetpercentage",
        `${getal(s.vet.waarde, 1)}%`,
        `${s.vet.bron === "gemeten" ? "zelf gemeten" : "geschat uit taille en nek (± 3–4%)"}, ${dagKort(s.vet.datum)}`,
        "vetpercentage",
      ),
      waardeRij("Vetvrije massa", kg(s.vet.vetvrijeMassa, 1), "spieren, botten, organen en water", null),
    );
  }
  if (s.ffmi) {
    rijen.push(
      waardeRij(
        "FFMI",
        getal(s.ffmi.ffmi, 1),
        `gecorrigeerd voor lengte ${getal(s.ffmi.genormaliseerd, 1)}; natuurlijke sporters bleven onder ongeveer 25`,
        "ffmi",
      ),
    );
  }
  document.getElementById("samenstelling").innerHTML =
    rijen.join("") ||
    '<li class="lijst-meta">Vul je lengte in voor je BMI, en meet taille en nek voor je vetpercentage en FFMI.</li>';
}

function tekenEnergie() {
  const e = gegevens.energie;
  document.getElementById("energie").innerHTML = e
    ? [
        waardeRij("Rustverbruik", `${e.bmr} kcal`, `${escapeHtml(e.methode)}${e.methode === "Katch-McArdle" ? " (uit je vetvrije massa)" : ""}`, "energie"),
        waardeRij("Dagelijks verbruik", `${e.onderhoud} kcal`, "rustverbruik × je activiteit: hiermee blijf je gelijk", "energie"),
        waardeRij(
          "Om aan te komen",
          `${e.calorie.start} kcal`,
          `startpunt; bijsturen tussen ${e.calorie.min} en ${e.calorie.max} kcal op basis van je tempo hierboven`,
          "aankomen",
        ),
        waardeRij("Eiwit", `${e.eiwit.min}–${e.eiwit.max} g`, "per dag, 1,6–2,2 g per kg lichaamsgewicht", "eiwit"),
      ].join("")
    : '<li class="lijst-meta">Vul je lengte, geboortedatum en geslacht in (of meet je vetpercentage) om je verbruik te berekenen.</li>';
}

function tekenMetingen() {
  const metingen = gegevens.metingen;
  const maat = (w, eenheid = " cm") => (w === null ? null : `${getal(w, 1)}${eenheid}`);
  document.getElementById("metingen").innerHTML = metingen
    .map((m) => {
      const delen = [
        m.vetpercentage !== null && `vet ${maat(m.vetpercentage, "%")}`,
        m.tailleCm !== null && `taille ${maat(m.tailleCm)}`,
        m.nekCm !== null && `nek ${maat(m.nekCm)}`,
        m.heupCm !== null && `heup ${maat(m.heupCm)}`,
        m.armCm !== null && `arm ${maat(m.armCm)}`,
        m.borstCm !== null && `borst ${maat(m.borstCm)}`,
        m.dijCm !== null && `bovenbeen ${maat(m.dijCm)}`,
      ].filter(Boolean);
      return `
        <li class="lijst-rij">
          <span><strong>${dagKort(m.datum)}</strong><br /><span class="lijst-meta">${escapeHtml(delen.join(" · "))}</span></span>
          <button type="button" class="text-link gevaar-link" data-wis="${m.datum}" aria-label="Meting van ${dagKort(m.datum)} verwijderen">Wis</button>
        </li>`;
    })
    .join("");
}

function vulProfiel(activiteiten) {
  const p = gegevens.profiel;
  const select = document.getElementById("profiel-activiteit");
  if (!select.options.length) {
    select.innerHTML = Object.entries(activiteiten)
      .map(([sleutel, a]) => `<option value="${sleutel}">${escapeHtml(a.uitleg)} (× ${getal(a.factor, 3)})</option>`)
      .join("");
  }
  select.value = p.activiteit;
  document.getElementById("profiel-lengte").value = p.lengteCm === null ? "" : getal(p.lengteCm, 1);
  document.getElementById("profiel-geboortedatum").value = p.geboortedatum ?? "";
  document.getElementById("profiel-geslacht").value = p.geslacht ?? "";
  document.getElementById("profiel-doel").value = p.doelgewicht === null ? "" : getal(p.doelgewicht, 1);
  document.getElementById("profiel-tempo-min").value = p.tempoMin === null ? "" : getal(p.tempoMin, 2);
  document.getElementById("profiel-tempo-max").value = p.tempoMax === null ? "" : getal(p.tempoMax, 2);
  const { doel } = gegevens;
  document.getElementById("profiel-doel").placeholder = doel.gewicht ? getal(doel.gewicht, 1) : "";
  document.getElementById("profiel-tempo-min").placeholder = getal(doel.tempoMin, 2);
  document.getElementById("profiel-tempo-max").placeholder = getal(doel.tempoMax, 2);
  document.getElementById("doel-hint").textContent =
    doel.bron === "programma" && p.doelgewicht === null
      ? "Leeg = het doel uit je programma (in grijs)."
      : "Leeg laten = het doel uit je programma, of 0,25–0,5% van je gewicht per week.";
  document.getElementById("heup-veld").hidden = p.geslacht !== "vrouw";
}

function tekenOntbreekt() {
  const el = document.getElementById("ontbreekt");
  const lijst = gegevens.ontbreekt.map((o) => ONTBREEKT[o]).filter(Boolean);
  el.hidden = lijst.length === 0;
  el.textContent = `Nog nodig voor alle berekeningen: ${lijst.join(", ")}. Vul ze onderaan in bij Profiel en doel.`;
}

async function laad() {
  const [lichaam, profiel] = await Promise.all([api("/api/lichaam"), api("/api/profiel")]);
  gegevens = lichaam;
  tekenOntbreekt();
  tekenGewicht();
  tekenSamenstelling();
  tekenEnergie();
  tekenMetingen();
  vulProfiel(profiel.activiteiten);
  const datum = document.getElementById("meting-datum");
  if (!datum.value) datum.value = gegevens.vandaag;
  datum.max = gegevens.vandaag;
}

// ---------- Invoer ----------

document.getElementById("gewicht-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const foutEl = document.getElementById("gewicht-fout");
  const invoer = document.getElementById("gewicht-invoer");
  const waarde = leesGetal(invoer.value);
  foutEl.textContent = "";
  if (waarde === null) {
    foutEl.textContent = "Vul je gewicht in, bijvoorbeeld 81,4.";
    return;
  }
  try {
    await api(`/api/lichaamsgewicht/${gegevens.vandaag}`, { methode: "PUT", body: { gewicht: waarde } });
    invoer.value = "";
    invoer.blur();
    await laad();
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
});

document.getElementById("meting-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const foutEl = document.getElementById("meting-fout");
  foutEl.textContent = "";
  const veld = (id) => leesGetal(document.getElementById(id).value);
  const body = {
    vetpercentage: veld("meting-vet"),
    tailleCm: veld("meting-taille"),
    nekCm: veld("meting-nek"),
    heupCm: veld("meting-heup"),
    armCm: veld("meting-arm"),
    borstCm: veld("meting-borst"),
    dijCm: veld("meting-dij"),
  };
  const datum = document.getElementById("meting-datum").value;
  if (!datum || Object.values(body).every((w) => w === null)) {
    foutEl.textContent = "Vul een datum en minstens één maat in.";
    return;
  }
  try {
    await api(`/api/lichaamsmetingen/${datum}`, { methode: "PUT", body });
    document.getElementById("meting-form").reset();
    await laad();
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
});

document.getElementById("metingen").addEventListener("click", async (e) => {
  const knop = e.target.closest("[data-wis]");
  if (!knop || !confirm(`Meting van ${dagKort(knop.dataset.wis)} verwijderen?`)) return;
  try {
    await api(`/api/lichaamsmetingen/${knop.dataset.wis}`, { methode: "DELETE" });
    await laad();
  } catch (fout) {
    document.getElementById("meting-fout").textContent = foutTekst(fout);
  }
});

document.getElementById("profiel-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const foutEl = document.getElementById("profiel-fout");
  const succesEl = document.getElementById("profiel-succes");
  foutEl.textContent = "";
  succesEl.textContent = "";
  const veld = (id) => leesGetal(document.getElementById(id).value);
  try {
    await api("/api/profiel", {
      methode: "PUT",
      body: {
        lengteCm: veld("profiel-lengte"),
        geboortedatum: document.getElementById("profiel-geboortedatum").value || null,
        geslacht: document.getElementById("profiel-geslacht").value || null,
        activiteit: document.getElementById("profiel-activiteit").value,
        doelgewicht: veld("profiel-doel"),
        tempoMin: veld("profiel-tempo-min"),
        tempoMax: veld("profiel-tempo-max"),
      },
    });
    succesEl.textContent = "Opgeslagen.";
    await laad();
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
});

document.getElementById("profiel-geslacht").addEventListener("change", (e) => {
  document.getElementById("heup-veld").hidden = e.target.value !== "vrouw";
});

vereisSessie().then(() =>
  laad().catch((fout) => {
    document.getElementById("ontbreekt").hidden = false;
    document.getElementById("ontbreekt").textContent = foutTekst(fout);
  }),
);
