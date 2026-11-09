// Het beginscherm: welke training aan de beurt is, je gewicht en je laatste trainingen.

const startKnop = document.getElementById("start-knop");
const startFout = document.getElementById("start-fout");
const andereSchemas = document.getElementById("andere-schemas");
let gegevens = null;

async function start(schemaId, licht = false) {
  startFout.textContent = "";
  startKnop.disabled = true;
  try {
    const { id } = await api("/api/trainingen", { methode: "POST", body: licht ? { schemaId, licht } : { schemaId } });
    window.location.href = `/training.html?id=${id}`;
  } catch (fout) {
    if (fout.status === 409 && fout.data?.id) {
      window.location.href = `/training.html?id=${fout.data.id}`;
      return;
    }
    startFout.textContent = foutTekst(fout);
    startKnop.disabled = false;
  }
}

function faseHtml(programma) {
  const { fase } = programma;
  const delen = [];
  if (fase.fase === "intro") {
    delen.push(
      `<p><strong>Introfase · week ${fase.week} van ${programma.introWeken}.</strong> ${programma.introSets ?? ""} sets per oefening, RIR ${programma.introRir ?? "–"}: wennen voor pezen en gewrichten.</p>`,
    );
  } else if (fase.fase === "deload") {
    delen.push(
      `<p><strong>Deloadweek${fase.handmatig ? " (op jouw verzoek)" : ` · week ${fase.week}`}.</strong> Halve sets, zelfde gewicht.</p>`,
    );
  } else {
    const tot = programma.deloadElkeWeken ? programma.deloadElkeWeken - (fase.week % programma.deloadElkeWeken) : null;
    delen.push(`<p>Week ${fase.week} van ${escapeHtml(programma.naam)}${tot ? ` · deload over ${tot} ${tot === 1 ? "week" : "weken"}` : ""}.</p>`);
  }
  if (programma.rustAdvies) {
    delen.push(`<p class="lijst-meta">Je programma adviseert minstens ${programma.minRustdagen} rustdag tussen trainingen.</p>`);
  }
  // Handmatige deload aan of uit; een automatische deloadweek kun je niet wegtikken.
  if (fase.fase !== "deload") {
    delen.push('<button type="button" class="text-link" data-deload="aan">Ik heb een deload nodig</button>');
  } else if (fase.handmatig) {
    delen.push('<button type="button" class="text-link" data-deload="uit">Deload stoppen</button>');
  }
  return delen.join("");
}

function tekenTraining() {
  const { programma, bezig, volgendeSchema, schemas, recent } = gegevens;
  const kop = document.getElementById("kop");
  const ondertitel = document.getElementById("ondertitel");
  const faseInfo = document.getElementById("fase-info");
  andereSchemas.innerHTML = "";
  startKnop.hidden = false;
  faseInfo.hidden = !programma;
  if (programma) faseInfo.innerHTML = faseHtml(programma);

  if (bezig) {
    kop.textContent = `${bezig.schemaNaam} loopt nog`;
    ondertitel.textContent = `Training ${bezig.schemaCode}, gestart ${datumKort(bezig.datum)}.`;
    startKnop.textContent = "Verder met trainen";
    startKnop.onclick = () => (window.location.href = `/training.html?id=${bezig.id}`);
    return;
  }
  if (!volgendeSchema) {
    startKnop.hidden = true;
    if (!programma) {
      // Nieuw account: welkom bovenaan, met één knop. Het trainingsblok is dan leeg en verdwijnt.
      kop.textContent = "Welkom bij RSLNT";
      ondertitel.textContent = "Je hebt nog geen schema. Begin hieronder.";
      document.getElementById("welkom-paneel").hidden = false;
      document.getElementById("training-paneel").hidden = true;
      return;
    }
    kop.textContent = "Nog geen trainingen in je programma";
    ondertitel.innerHTML = 'Voeg oefeningen toe onder <a href="/schema.html">Schema</a>, of maak een <a href="/personaliseren.html">schema op maat</a>.';
    return;
  }

  const laatste = recent[0];
  const duur = volgendeSchema.minuten ? `± ${volgendeSchema.minuten} min` : "";
  const vorige = laatste ? `Vorige: ${laatste.schemaNaam}, ${datumKort(laatste.datum)}.` : "Je eerste training: kies startgewichten waarmee je de range netjes haalt.";
  const plan = gegevens.planning;
  if (plan?.vandaag) {
    // Weekplanner: vandaag staat er een training gepland.
    kop.textContent = `Vandaag: ${volgendeSchema.naam}`;
    ondertitel.textContent = [`Gepland om ${plan.vandaag.tijd}`, duur, vorige].filter(Boolean).join(" · ");
    startKnop.textContent = `Start ${volgendeSchema.naam}`;
  } else if (plan?.volgende) {
    const wanneer = new Date(`${plan.volgende.datum}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "long" });
    kop.textContent = "Vandaag: rust";
    ondertitel.textContent = `Volgende: ${plan.volgende.naam}, ${wanneer} om ${plan.volgende.tijd}. Toch vandaag trainen? Dat kan hieronder.`;
    startKnop.textContent = `Toch nu: ${volgendeSchema.naam}`;
  } else {
    kop.textContent = `${volgendeSchema.naam} is aan de beurt`;
    ondertitel.textContent = [`Training ${volgendeSchema.code}`, duur, vorige].filter(Boolean).join(" · ");
    startKnop.textContent = `Start ${volgendeSchema.naam}`;
  }
  startKnop.onclick = () => start(volgendeSchema.id);

  for (const schema of schemas.filter((s) => s.id !== volgendeSchema.id)) {
    const knop = document.createElement("button");
    knop.type = "button";
    knop.className = "text-link set-extra";
    knop.textContent = `Liever ${schema.code} · ${schema.naam}`;
    knop.addEventListener("click", () => start(schema.id));
    andereSchemas.append(knop);
  }
  const week = document.createElement("a");
  week.className = "text-link set-extra";
  week.href = "/week.html";
  week.textContent = plan ? "Je week bekijken en aanpassen →" : "Plan je week: vaste dagen voor je trainingen →";
  andereSchemas.append(week);
}

document.getElementById("fase-info").addEventListener("click", async (e) => {
  const knop = e.target.closest("[data-deload]");
  if (!knop) return;
  const aan = knop.dataset.deload === "aan";
  if (aan && !confirm("Een week deload: halve sets, zelfde gewicht. Handig als je herstel een paar trainingen slecht is. Starten?")) return;
  try {
    await api(`/api/programmas/${gegevens.programma.id}/deload`, { methode: "POST", body: { aan } });
    gegevens = await api("/api/vandaag");
    tekenTraining();
  } catch (fout) {
    startFout.textContent = foutTekst(fout);
  }
});

const DUUR_ICOON = { hardlopen: "🏃", fietsen: "🚴", zwemmen: "🏊" };

/** De duursessie van vandaag (duurschema), met een knop om hem af te vinken. */
function tekenDuur() {
  const paneel = document.getElementById("duur-paneel");
  const d = gegevens.duur;
  if (!d) {
    paneel.hidden = true;
    return;
  }
  paneel.hidden = false;
  const omvang = [d.meters ? `${d.meters} m` : null, `± ${d.minuten} min`, `om ${d.tijd}`].filter(Boolean).join(" · ");
  paneel.innerHTML = `
    <p class="kicker">Duurtraining · week ${d.week}</p>
    <h2>${DUUR_ICOON[d.sport] ?? ""} ${escapeHtml(d.titel)}</h2>
    <p class="lijst-meta">${escapeHtml(omvang)}</p>
    <p>${escapeHtml(d.uitleg)}</p>
    ${
      d.gedaan
        ? '<p class="success">✓ Gedaan. Goed bezig.</p>'
        : '<button type="button" id="duur-gedaan">Gedaan</button>'
    }
    <a class="text-link set-extra" href="/duurschema.html">Je duurschema →</a>
    <p class="error" id="duur-fout" role="alert"></p>`;
  document.getElementById("duur-gedaan")?.addEventListener("click", async (e) => {
    e.target.disabled = true;
    try {
      await api("/api/duurschema/gedaan", { methode: "POST", body: { datum: d.datum } });
      gegevens.duur.gedaan = true;
      tekenDuur();
    } catch (f) {
      document.getElementById("duur-fout").textContent = foutTekst(f);
      e.target.disabled = false;
    }
  });
}

function tekenGewicht() {
  const { gewicht } = gegevens;
  document.getElementById("gemiddelde").textContent = gewicht.gemiddelde7 === null ? "–" : kg(gewicht.gemiddelde7, 1);
  document.getElementById("laatste").textContent = gewicht.laatste ? kg(gewicht.laatste.gewicht, 1) : "–";
  document.getElementById("laatste-label").textContent = gewicht.laatste
    ? gewicht.laatste.datum === gewicht.vandaag
      ? "vandaag gewogen"
      : `laatste weging, ${dagKort(gewicht.laatste.datum)}`
    : "nog geen weging";
}

function tekenRecent() {
  const lijst = document.getElementById("recent");
  if (gegevens.recent.length === 0) {
    lijst.innerHTML = '<li class="lijst-meta">Nog geen trainingen.</li>';
    return;
  }
  lijst.innerHTML = gegevens.recent
    .map(
      (t) => `
      <li>
        <a class="lijst-rij" href="/training.html?id=${encodeURIComponent(t.id)}">
          <span><strong>${escapeHtml(t.schemaCode)} · ${escapeHtml(t.schemaNaam)}</strong><br /><span class="lijst-meta">${datumKort(t.datum)} · ${t.aantalSets} sets${t.fase === "deload" ? " · deload" : t.fase === "intro" ? " · intro" : t.fase === "licht" ? " · lichte dag" : ""}</span></span>
          ${t.status === "bezig" ? '<span class="badge badge-bezig">Bezig</span>' : '<span class="badge badge-succes">Klaar</span>'}
        </a>
      </li>`,
    )
    .join("");
}

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
    await api(`/api/lichaamsgewicht/${gegevens.gewicht.vandaag}`, { methode: "PUT", body: { gewicht: waarde } });
    invoer.value = "";
    invoer.blur();
    gegevens = await api("/api/vandaag");
    tekenGewicht();
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
});

// ---------- Herstelcheck ----------

const HERSTEL = [
  { item: "slaap", label: "Slaap", laag: "slecht", hoog: "top" },
  { item: "energie", label: "Energie", laag: "leeg", hoog: "vol" },
  { item: "spierpijn", label: "Spierpijn", laag: "geen", hoog: "veel" },
  { item: "pijn", label: "Pijntjes", laag: "geen", hoog: "veel" },
];
const STATUS = { goed: { teken: "✓", tekst: "goed" }, neutraal: { teken: "–", tekst: "gemiddeld" }, let_op: { teken: "!", tekst: "let op" } };
let herstelKeuze = { pijnPlekken: [] };

/** Vanaf 2 bij pijntjes: waar (optioneel, meer dan één mag). */
function plekRijHtml() {
  if (!(herstelKeuze.pijn >= 2)) return "";
  const knoppen = Object.entries(PIJN_PLEKKEN)
    .map(([plek, naam]) => `<button type="button" class="plek" data-plek="${plek}" aria-pressed="${herstelKeuze.pijnPlekken.includes(plek)}">${naam}</button>`)
    .join("");
  return `
    <div class="herstel-rij">
      <div class="herstel-kop"><span class="veld-label">Waar?</span><span class="schaal-uitleg">optioneel, meer mag</span></div>
      <div class="plekken" role="group" aria-label="Waar heb je pijntjes?">${knoppen}</div>
    </div>`;
}

function tekenHerstelForm() {
  document.getElementById("herstel-rijen").innerHTML = HERSTEL.map(
    (h) => `
    <div class="herstel-rij">
      <div class="herstel-kop"><span class="veld-label">${h.label}</span><span class="schaal-uitleg">1 = ${h.laag} · 5 = ${h.hoog}</span></div>
      <div class="keuzes" role="group" aria-label="${h.label}, 1 ${h.laag} tot 5 ${h.hoog}">
        ${[1, 2, 3, 4, 5].map((w) => `<button type="button" class="keuze" data-item="${h.item}" data-waarde="${w}" aria-pressed="${herstelKeuze[h.item] === w}">${w}</button>`).join("")}
      </div>
    </div>`,
  ).join("") + plekRijHtml();
  document.getElementById("herstel-opslaan").disabled = HERSTEL.some((h) => !herstelKeuze[h.item]);
}

function tekenHerstel() {
  const { herstel, programma } = gegevens;
  // Zonder schema is er nog geen training om je op voor te bereiden: eerst de eerste stap.
  document.getElementById("herstel-paneel").hidden = !programma;
  if (!programma) return;
  const form = document.getElementById("herstel-form");
  const signalenEl = document.getElementById("herstel-signalen");
  if (!herstel.check) {
    form.hidden = false;
    signalenEl.hidden = true;
    tekenHerstelForm();
    return;
  }
  form.hidden = true;
  signalenEl.hidden = false;
  const chips = herstel.signalen
    .map((s) => {
      const st = STATUS[s.status];
      const gem = s.gemiddelde === null ? "" : ` · gem. ${getal(s.gemiddelde, 1)}`;
      const plekken = s.item === "pijn" && herstel.check.pijnPlekken?.length
        ? `<br /><span class="lijst-meta">${herstel.check.pijnPlekken.map((p) => escapeHtml(PIJN_PLEKKEN[p] ?? p)).join(", ")}</span>`
        : "";
      return `<li class="signaal signaal-${s.status}"><span class="signaal-teken" aria-hidden="true">${st.teken}</span><span><strong>${s.label} ${s.waarde}</strong><br /><span class="lijst-meta">${st.tekst}${gem}</span>${plekken}</span></li>`;
    })
    .join("");
  signalenEl.innerHTML = `
    <ul class="signalen">${chips}</ul>
    ${herstel.deloadOverwegen ? '<p class="melding">Je herstel was een paar keer matig. Overweeg een deloadweek (knop hieronder).</p>' : ""}
    <button type="button" class="text-link" id="herstel-aanpassen">Aanpassen</button>`;
}

document.getElementById("herstel-rijen").addEventListener("click", (e) => {
  const plek = e.target.closest("[data-plek]");
  if (plek) {
    const p = plek.dataset.plek;
    herstelKeuze.pijnPlekken = herstelKeuze.pijnPlekken.includes(p) ? herstelKeuze.pijnPlekken.filter((x) => x !== p) : [...herstelKeuze.pijnPlekken, p];
    tekenHerstelForm();
    return;
  }
  const knop = e.target.closest("[data-item]");
  if (!knop) return;
  herstelKeuze[knop.dataset.item] = Number(knop.dataset.waarde);
  tekenHerstelForm();
});

document.getElementById("herstel-signalen").addEventListener("click", (e) => {
  if (e.target.id !== "herstel-aanpassen") return;
  const { check } = gegevens.herstel;
  herstelKeuze = { slaap: check.slaap, energie: check.energie, spierpijn: check.spierpijn, pijn: check.pijn, pijnPlekken: [...(check.pijnPlekken ?? [])] };
  document.getElementById("herstel-form").hidden = false;
  document.getElementById("herstel-signalen").hidden = true;
  tekenHerstelForm();
});

document.getElementById("herstel-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const foutEl = document.getElementById("herstel-fout");
  foutEl.textContent = "";
  try {
    const body = { ...herstelKeuze, pijnPlekken: herstelKeuze.pijn >= 2 ? herstelKeuze.pijnPlekken : [] };
    gegevens.herstel = await api(`/api/herstel/${gegevens.gewicht.vandaag}`, { methode: "PUT", body });
    tekenHerstel();
    // Het advies voor vandaag hangt van je check af.
    haalSessie().then((g) => g && !g.offline && laadAdvies(g));
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
});

// ---------- Advies voor vandaag (Pro) ----------

const ADVIES_KOP = { normaal: "Gewoon trainen", lichte_dag: "Liever een lichte dag", deload: "Tijd voor een deloadweek" };

function adviesHtml(a) {
  const { bezig, volgendeSchema, programma } = gegevens;
  const kanStarten = !bezig && volgendeSchema;
  // Een introfase of deload is al licht; daar komt geen lichte dag bovenop (zie POST /api/trainingen).
  const alLicht = programma && programma.fase.fase !== "normaal";
  const knoppen = [];
  if (kanStarten && a.advies === "lichte_dag" && !alLicht) knoppen.push('<button type="button" data-advies="licht">Start lichte training</button>');
  if (a.advies === "deload" && programma?.fase.fase !== "deload") knoppen.push('<button type="button" data-advies="deload">Start deloadweek</button>');
  if (kanStarten && a.advies !== "lichte_dag" && programma?.fase.fase === "normaal") {
    knoppen.push(`<button type="button" class="text-link" data-advies="licht">${a.advies === "deload" ? "Alleen vandaag licht" : "Toch een lichte dag"}</button>`);
  }
  const blok = a.blok
    ? `<p class="ruimte-boven"><strong>Blok: ${escapeHtml(a.blok.label)}</strong> · week ${a.blok.weekInBlok} van ${a.blok.wekenInBlok} (plan: week ${a.blok.week} van ${a.blok.totaalWeken}). <a href="/blokken.html">Je plan</a></p>`
    : '<p class="lijst-meta ruimte-boven">Naar een doel toe trainen? <a href="/blokken.html">Plan blokken</a></p>';
  const hybride = a.hybride.meldingen.map((m) => `<p class="melding ruimte-boven">${escapeHtml(m)}</p>`).join("");
  const duur = a.hybride.week.sessies
    ? `${a.hybride.week.sessies} duurtraining${a.hybride.week.sessies === 1 ? "" : "en"}, ${a.hybride.week.minuten} min in 7 dagen. `
    : "";
  return `
    <div class="pro-kop"><h2>Advies voor vandaag</h2><span class="badge pro-badge">Pro</span></div>
    <p class="advies-kop">${ADVIES_KOP[a.advies]}</p>
    <ul class="lijst-meta">${a.redenen.map((r) => `<li>${escapeHtml(r)}</li>`).join("")}</ul>
    ${alLicht && a.advies !== "normaal" ? `<p class="lijst-meta ruimte-boven">Je zit al in je ${programma.fase.fase === "intro" ? "introfase" : "deloadweek"}: die is al licht. Train rustig en luister naar je lichaam.</p>` : ""}
    ${knoppen.length ? `<div class="knop-rij ruimte-boven">${knoppen.join("")}</div>` : ""}
    ${blok}
    ${hybride}
    <p class="lijst-meta ruimte-boven">${duur}<a href="/duur.html">Duurtraining loggen</a> · <a href="/wetenschap.html#slim-herstel">Waarom?</a></p>`;
}

async function laadAdvies(g) {
  const paneel = document.getElementById("advies-paneel");
  // Zonder schema eerst de eerste stap; dan nog geen Pro erbij.
  if (!gegevens.programma) return;
  if (!g.pro) {
    toonProSlot(
      paneel,
      "Advies voor vandaag",
      "Je herstelcheck en voorstel werken gratis. Met Pro maakt RSLNT er een concrete keuze van, en houdt het rekening met je duurtraining:",
      ["advies", "bijsturen", "blokken", "hybride"],
    );
    return;
  }
  try {
    const advies = await api("/api/pro/vandaag");
    paneel.classList.remove("pro-slot");
    paneel.innerHTML = adviesHtml(advies);
    paneel.hidden = false;
  } catch {
    paneel.hidden = true;
  }
}

document.getElementById("advies-paneel").addEventListener("click", async (e) => {
  const knop = e.target.closest("[data-advies]");
  if (!knop) return;
  if (knop.dataset.advies === "licht") {
    start(gegevens.volgendeSchema.id, true);
    return;
  }
  if (!confirm("Een week deload: halve sets, zelfde gewicht. Starten?")) return;
  try {
    await api(`/api/programmas/${gegevens.programma.id}/deload`, { methode: "POST", body: { aan: true } });
    gegevens = await api("/api/vandaag");
    tekenTraining();
    laadAdvies(await haalSessie());
  } catch (fout) {
    startFout.textContent = foutTekst(fout);
  }
});

async function laad() {
  document.getElementById("vandaag-datum").textContent = new Date().toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const sessie = await vereisSessie();
  // Met Pro meteen onder je training; zonder Pro onderaan, na de gratis inhoud.
  toonWensKaart(document.getElementById(sessie.pro ? "wens-kaart" : "wens-kaart-onder"), Boolean(sessie.pro), { wegklikbaar: true });
  try {
    gegevens = await api("/api/vandaag");
  } catch (fout) {
    document.getElementById("kop").textContent = "Kon niet laden";
    startFout.textContent = foutTekst(fout);
    return;
  }
  tekenHerstel();
  tekenTraining();
  tekenDuur();
  tekenGewicht();
  tekenRecent();
  if (!sessie.offline) laadAdvies(sessie);
}

laad();
