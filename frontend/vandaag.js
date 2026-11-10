// Vandaag: je week, je training van vandaag (met het advies), de herstelcheck als je er iets aan
// hebt, en je recente trainingen. Je gewicht en de status van je lichaam staan onder Lichaam.

const startKnop = document.getElementById("start-knop");
const startFout = document.getElementById("start-fout");
let gegevens = null;
let week = null;
let proAdvies = null;
let samen = null;
let sessie = null;

const DUUR_ICOON = { hardlopen: "🏃", fietsen: "🚴", zwemmen: "🏊" };
const DAG_KORT = ["ma", "di", "wo", "do", "vr", "za", "zo"];
const weekdagNaam = (datum) => new Date(`${datum}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "long" });

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

// ---------- 1. Je week ----------

function tekenWeek() {
  const strip = document.getElementById("week-strip");
  if (!week || (!week.programma && !week.duurschema)) {
    strip.hidden = true;
    return;
  }
  strip.hidden = false;
  const dagen = week.dagen
    .map((d, i) => {
      const gedaan = d.gedaan.length > 0 || d.duur?.gedaan;
      const iets = d.training || d.duur;
      const vandaag = d.datum === week.vandaag;
      const teken = gedaan ? "✓" : d.duur && !d.training ? (DUUR_ICOON[d.duur.sport] ?? "•") : iets ? "•" : "";
      const titel = [d.training, d.duur?.titel].filter(Boolean).join(" + ") || "rust";
      return `<span class="week-dag-mini${vandaag ? " vandaag" : ""}${gedaan ? " gedaan" : ""}${iets ? " gepland" : ""}${d.datum < week.vandaag ? " voorbij" : ""}" title="${escapeHtml(titel)}">
        <span class="wd-naam">${DAG_KORT[i]}</span>
        <span class="wd-nummer">${Number(d.datum.slice(8))}</span>
        <span class="wd-teken" aria-hidden="true">${teken}</span>
      </span>`;
    })
    .join("");
  const gepland = week.dagen.filter((d) => d.training || d.duur).length;
  const gedaan = week.dagen.filter((d) => d.gedaan.length > 0 || d.duur?.gedaan).length;
  strip.innerHTML = `
    <div class="panel-kop"><h2>Je week</h2><span class="lijst-meta">${gepland ? `${gedaan} van ${gepland} gedaan ` : ""}›</span></div>
    <div class="week-mini">${dagen}</div>`;
}

// ---------- 2. Je training van vandaag ----------

/** Het advies voor vandaag in één blok: met Pro de keuze van RSLNT, anders wat er nu speelt. */
function adviesHtml() {
  const { programma, herstel, bezig, volgendeSchema } = gegevens;
  if (!programma) return "";
  if (proAdvies) {
    const a = proAdvies;
    const alLicht = programma.fase.fase !== "normaal";
    const kanStarten = !bezig && volgendeSchema;
    const knoppen = [];
    if (kanStarten && a.advies === "lichte_dag" && !alLicht) knoppen.push('<button type="button" class="secondary" data-advies="licht">Start lichte training</button>');
    if (a.advies === "deload" && programma.fase.fase !== "deload") knoppen.push('<button type="button" class="secondary" data-advies="deload">Start deloadweek</button>');
    const kop = { normaal: "Gewoon trainen", lichte_dag: "Liever een lichte dag", deload: "Tijd voor een deloadweek" }[a.advies];
    const redenen = [...a.redenen.slice(0, 2), ...a.hybride.meldingen.slice(0, 1)];
    return `<p class="advies-kop"><strong>${kop}</strong> <span class="badge pro-badge">Pro</span></p>
      ${redenen.map((r) => `<p class="lijst-meta">${escapeHtml(r)}</p>`).join("")}
      ${knoppen.length ? `<div class="knop-rij">${knoppen.join("")}</div>` : ""}`;
  }
  const regels = [];
  const { fase } = programma;
  if (fase.fase === "intro") regels.push(`<strong>Introfase, week ${fase.week} van ${programma.introWeken}.</strong> Minder sets, ruim reps over: wennen voor pezen en gewrichten.`);
  if (fase.fase === "deload") regels.push("<strong>Deloadweek.</strong> Halve sets, zelfde gewicht.");
  const letOp = herstel.check ? herstel.signalen.filter((s) => s.status === "let_op").map((s) => s.label.toLowerCase()) : [];
  if (letOp.length) regels.push(`<strong>Let op je ${letOp.join(" en ")}.</strong> Rustig aan; voelt het niet goed, doe minder sets.`);
  if (herstel.deloadOverwegen) regels.push("Je herstel was een paar keer matig. Overweeg een deloadweek (Meer opties).");
  if (programma.rustAdvies && !bezig) regels.push(`Je programma adviseert minstens ${programma.minRustdagen} rustdag tussen trainingen.`);
  return regels.map((r) => `<p>${r}</p>`).join("");
}

function tekenTraining() {
  const { programma, bezig, volgendeSchema, schemas, recent, duur } = gegevens;
  const paneel = document.getElementById("training-paneel");
  const kicker = document.getElementById("workout-kicker");
  const titel = document.getElementById("workout-titel");
  const meta = document.getElementById("workout-meta");
  const extra = document.getElementById("workout-extra");
  const meer = document.getElementById("meer-lijst");
  startKnop.hidden = true;
  startKnop.classList.remove("secondary");
  extra.innerHTML = "";
  meer.innerHTML = "";

  if (!programma && !duur && !samen) {
    // Nieuw account: alleen de eerste stap.
    document.getElementById("welkom-paneel").hidden = false;
    paneel.hidden = true;
    document.getElementById("recent-paneel").hidden = true;
    return;
  }
  paneel.hidden = false;
  const plan = gegevens.planning;
  const opties = [];

  if (bezig) {
    kicker.textContent = "Bezig";
    titel.textContent = bezig.schemaNaam;
    meta.textContent = `Gestart ${datumKort(bezig.datum)}`;
    startKnop.textContent = "Verder met trainen";
    startKnop.hidden = false;
    startKnop.onclick = () => (window.location.href = `/training.html?id=${bezig.id}`);
  } else if (volgendeSchema) {
    const minuten = volgendeSchema.minuten ? `± ${volgendeSchema.minuten} min` : null;
    const eerste = recent[0] ? null : "je eerste training";
    if (plan?.vandaag) {
      kicker.textContent = `Vandaag · ${plan.vandaag.tijd}`;
      titel.textContent = volgendeSchema.naam;
      meta.textContent = [minuten, eerste].filter(Boolean).join(" · ");
      startKnop.textContent = "Start training";
    } else if (plan?.volgende) {
      kicker.textContent = "Vandaag";
      titel.textContent = "Rustdag";
      meta.textContent = `Volgende: ${plan.volgende.naam}, ${weekdagNaam(plan.volgende.datum)} om ${plan.volgende.tijd}`;
      startKnop.textContent = `Toch trainen: ${volgendeSchema.naam}`;
      startKnop.classList.add("secondary");
    } else {
      kicker.textContent = "Aan de beurt";
      titel.textContent = volgendeSchema.naam;
      meta.textContent = [minuten, eerste].filter(Boolean).join(" · ");
      startKnop.textContent = "Start training";
    }
    startKnop.hidden = false;
    startKnop.disabled = false;
    startKnop.onclick = () => start(volgendeSchema.id);
    for (const s of schemas.filter((x) => x.id !== volgendeSchema.id)) {
      opties.push(`<button type="button" class="meer-rij" data-schema="${s.id}">${escapeHtml(s.naam)}<span class="lijst-meta">start</span></button>`);
    }
  } else if (programma) {
    kicker.textContent = "Vandaag";
    titel.textContent = "Nog geen oefeningen";
    meta.innerHTML = 'Voeg oefeningen toe onder <a href="/schema.html">Schema</a>.';
  } else {
    kicker.textContent = "Vandaag";
    titel.textContent = duur ? "Duurtraining" : "Samen trainen";
    meta.textContent = "";
  }

  // Wat er vandaag nog meer is: je duurtraining en een samen-training.
  if (duur) {
    const omvang = [duur.meters ? `${duur.meters} m` : null, `${duur.minuten} min`, duur.tijd].filter(Boolean).join(" · ");
    extra.insertAdjacentHTML(
      "beforeend",
      `<div class="extra-rij" id="duur-paneel">
        <span class="extra-icoon" aria-hidden="true">${DUUR_ICOON[duur.sport] ?? "•"}</span>
        <a class="extra-tekst" href="/duurschema.html"><strong>${escapeHtml(duur.titel)}</strong><span class="lijst-meta">${escapeHtml(omvang)}</span></a>
        ${duur.gedaan ? '<span class="badge badge-succes">✓ Gedaan</span>' : '<button type="button" class="secondary klein" id="duur-gedaan">Gedaan</button>'}
      </div>`,
    );
  }
  if (samen) {
    const anderen = samen.deelnemers.filter((d) => !d.ikzelf).map((d) => d.naam);
    const doel = samen.mijnTrainingId ? `/training.html?id=${encodeURIComponent(samen.mijnTrainingId)}` : `/samen.html?code=${encodeURIComponent(samen.code)}`;
    extra.insertAdjacentHTML(
      "beforeend",
      `<a class="extra-rij" id="samen-paneel" href="${doel}">
        <span class="extra-icoon" aria-hidden="true">👥</span>
        <span class="extra-tekst"><strong>Samen: ${escapeHtml(samen.naam)}</strong><span class="lijst-meta">${escapeHtml(anderen.length ? `met ${anderen.join(", ")}` : `code ${samen.code}`)}</span></span>
        <span class="extra-pijl" aria-hidden="true">›</span>
      </a>`,
    );
  }

  const advies = adviesHtml();
  const adviesEl = document.getElementById("advies");
  adviesEl.innerHTML = advies;
  adviesEl.hidden = !advies;

  // Meer opties: alles wat je niet elke dag nodig hebt.
  if (programma && !bezig) {
    if (programma.fase.fase !== "deload") opties.push('<button type="button" class="meer-rij" data-deload="aan">Ik heb een deload nodig<span class="extra-pijl">›</span></button>');
    else if (programma.fase.handmatig) opties.push('<button type="button" class="meer-rij" data-deload="uit">Deload stoppen<span class="extra-pijl">›</span></button>');
  }
  opties.push('<a class="meer-rij" href="/samen.html">Samen trainen<span class="extra-pijl">›</span></a>');
  opties.push(`<a class="meer-rij" href="/duurschema.html">${duur || week?.duurschema ? "Je duurschema" : "Hardlopen, fietsen of zwemmen erbij"}<span class="extra-pijl">›</span></a>`);
  meer.innerHTML = opties.join("");
}

document.getElementById("training-paneel").addEventListener("click", async (e) => {
  const schema = e.target.closest("[data-schema]");
  if (schema) return start(schema.dataset.schema);
  const advies = e.target.closest("[data-advies]");
  if (advies) {
    if (advies.dataset.advies === "licht") return start(gegevens.volgendeSchema.id, true);
    if (!confirm("Een week deload: halve sets, zelfde gewicht. Starten?")) return;
    return zetDeload(true);
  }
  const deload = e.target.closest("[data-deload]");
  if (deload) {
    const aan = deload.dataset.deload === "aan";
    if (aan && !confirm("Een week deload: halve sets, zelfde gewicht. Handig als je herstel een paar trainingen slecht is. Starten?")) return;
    return zetDeload(aan);
  }
  if (e.target.id === "duur-gedaan") {
    e.target.disabled = true;
    try {
      await api("/api/duurschema/gedaan", { methode: "POST", body: { datum: gegevens.duur.datum } });
      gegevens.duur.gedaan = true;
      tekenTraining();
      laadWeek();
    } catch (f) {
      startFout.textContent = foutTekst(f);
      e.target.disabled = false;
    }
  }
});

async function zetDeload(aan) {
  try {
    await api(`/api/programmas/${gegevens.programma.id}/deload`, { methode: "POST", body: { aan } });
    gegevens = await api("/api/vandaag");
    await laadAdvies();
    tekenTraining();
  } catch (fout) {
    startFout.textContent = foutTekst(fout);
  }
}

// ---------- 3. Herstelcheck: alleen als je er iets aan hebt ----------

const HERSTEL = [
  { item: "slaap", label: "Slaap", laag: "slecht", hoog: "top" },
  { item: "energie", label: "Energie", laag: "leeg", hoog: "vol" },
  { item: "spierpijn", label: "Spierpijn", laag: "geen", hoog: "veel" },
  { item: "pijn", label: "Pijntjes", laag: "geen", hoog: "veel" },
];
let herstelKeuze = { pijnPlekken: [] };
// Vanuit Lichaam (?herstel=1): de check meteen open, ook op een rustdag.
let herstelOpen = queryParam("herstel") === "1";

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
  document.getElementById("herstel-rijen").innerHTML =
    HERSTEL.map(
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

/**
 * Zichtbaar als je er iets aan hebt: op een trainingsdag voordat je begint (het advies hangt ervan
 * af), of als er na het invullen iets is om op te letten. Alles goed of een rustdag: niets. De
 * volledige stand staat onder Lichaam.
 */
function tekenHerstel() {
  const { herstel, programma, bezig, volgendeSchema, planning } = gegevens;
  const paneel = document.getElementById("herstel-paneel");
  const form = document.getElementById("herstel-form");
  const signalenEl = document.getElementById("herstel-signalen");
  const dicht = document.getElementById("herstel-dicht");
  const trainingsdag = Boolean(programma && volgendeSchema && !bezig && (planning ? planning.vandaag : true));
  form.hidden = true;
  dicht.hidden = true;
  signalenEl.hidden = true;

  if (!herstel.check || herstelOpen) {
    paneel.hidden = !(trainingsdag || herstelOpen);
    if (paneel.hidden) return;
    form.hidden = !herstelOpen;
    dicht.hidden = herstelOpen;
    tekenHerstelForm();
    return;
  }
  const letOp = herstel.signalen.filter((s) => s.status === "let_op");
  paneel.hidden = letOp.length === 0 && !herstel.deloadOverwegen;
  if (paneel.hidden) return;
  signalenEl.hidden = false;
  signalenEl.innerHTML = `
    <div class="panel-kop"><h2>Let op vandaag</h2><button type="button" class="text-link" id="herstel-aanpassen">Aanpassen</button></div>
    <ul class="signalen">${letOp
      .map((s) => {
        const plekken = s.item === "pijn" && herstel.check.pijnPlekken?.length ? ` · ${herstel.check.pijnPlekken.map((p) => escapeHtml(PIJN_PLEKKEN[p] ?? p)).join(", ")}` : "";
        return `<li class="signaal signaal-let_op"><span class="signaal-teken" aria-hidden="true">!</span><span><strong>${s.label} ${s.waarde}</strong><span class="lijst-meta">${plekken}</span></span></li>`;
      })
      .join("")}</ul>
    ${herstel.deloadOverwegen ? '<p class="lijst-meta">Je herstel was een paar keer matig. Een deloadweek kan helpen (Meer opties bij je training).</p>' : ""}`;
}

document.getElementById("herstel-open").addEventListener("click", () => {
  herstelOpen = true;
  tekenHerstel();
});

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
  herstelOpen = true;
  tekenHerstel();
});

document.getElementById("herstel-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const foutEl = document.getElementById("herstel-fout");
  foutEl.textContent = "";
  try {
    const body = { ...herstelKeuze, pijnPlekken: herstelKeuze.pijn >= 2 ? herstelKeuze.pijnPlekken : [] };
    gegevens.herstel = await api(`/api/herstel/${gegevens.gewicht.vandaag}`, { methode: "PUT", body });
    herstelOpen = false;
    // Het advies voor vandaag hangt van je check af.
    await laadAdvies();
    tekenHerstel();
    tekenTraining();
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
});

// ---------- 4. Recent ----------

function tekenRecent() {
  const lijst = document.getElementById("recent");
  if (gegevens.recent.length === 0) {
    lijst.innerHTML = '<li class="lijst-meta">Nog geen trainingen.</li>';
    return;
  }
  lijst.innerHTML = gegevens.recent
    .slice(0, 4)
    .map(
      (t) => `
      <li>
        <a class="lijst-rij" href="/training.html?id=${encodeURIComponent(t.id)}">
          <span><strong>${escapeHtml(t.schemaNaam)}</strong><br /><span class="lijst-meta">${datumKort(t.datum)} · ${t.aantalSets} sets</span></span>
          ${t.status === "bezig" ? '<span class="badge badge-bezig">Bezig</span>' : '<span class="extra-pijl" aria-hidden="true">›</span>'}
        </a>
      </li>`,
    )
    .join("");
}

// ---------- Laden ----------

async function laadAdvies() {
  proAdvies = null;
  if (!sessie?.pro || sessie.offline || !gegevens?.programma) return;
  try {
    proAdvies = await api("/api/pro/vandaag");
  } catch {
    proAdvies = null;
  }
}

async function laadWeek() {
  try {
    week = await api("/api/planning");
  } catch {
    week = null;
  }
  tekenWeek();
}

function groet() {
  const uur = new Date().getHours();
  const deel = uur < 6 ? "Goedenacht" : uur < 12 ? "Goedemorgen" : uur < 18 ? "Goedemiddag" : "Goedenavond";
  const naam = (sessie?.naam ?? "").trim().split(/\s+/)[0];
  return naam ? `${deel}, ${naam}` : deel;
}

async function laad() {
  document.getElementById("vandaag-datum").textContent = new Date().toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long" });
  sessie = await vereisSessie();
  document.getElementById("kop").textContent = groet();
  try {
    [gegevens, samen] = await Promise.all([api("/api/vandaag"), api("/api/samen/actief").then((r) => r.samen).catch(() => null)]);
  } catch (fout) {
    document.getElementById("kop").textContent = "Kon niet laden";
    document.getElementById("training-paneel").hidden = false;
    startFout.textContent = foutTekst(fout);
    return;
  }
  await laadAdvies();
  if (herstelOpen && gegevens.herstel.check) {
    const c = gegevens.herstel.check;
    herstelKeuze = { slaap: c.slaap, energie: c.energie, spierpijn: c.spierpijn, pijn: c.pijn, pijnPlekken: [...(c.pijnPlekken ?? [])] };
  }
  tekenTraining();
  tekenHerstel();
  if (herstelOpen) document.getElementById("herstel-paneel").scrollIntoView({ block: "start" });
  tekenRecent();
  laadWeek();
  // De Pro-kaart (schema in je eigen woorden) onderaan, na alles wat gratis is.
  if (gegevens.programma) toonWensKaart(document.getElementById("wens-kaart"), Boolean(sessie.pro), { wegklikbaar: true, compact: true });
}

laad();
