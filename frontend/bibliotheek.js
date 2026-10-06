// De oefeningenbibliotheek: zoeken en filteren (lijst) en één oefening met foto's, uitleg,
// favoriet/niet voor mij en toevoegen aan een training (detail, met ?id=).
// De filters staan in het adres, zodat "terug" vanaf een oefening je zoekopdracht bewaart.

const zoekEl = document.getElementById("zoek");
const spierEl = document.getElementById("filter-spier");
const materiaalEl = document.getElementById("filter-materiaal");
const patroonEl = document.getElementById("filter-patroon");
const knieEl = document.getElementById("filter-knie");
const favEl = document.getElementById("filter-favorieten");
const uitEl = document.getElementById("filter-uitgesloten");

let labels = null;
let pagina = 1;
let laadVolgnummer = 0;

function spierTekst(lijst) {
  return lijst.map((s) => labels?.spieren[s] ?? s).join(", ");
}

function rijHtml(o) {
  const meta = [labels?.materiaal[o.materiaal] ?? o.materiaal, spierTekst(o.spierenPrimair)].filter(Boolean).join(" · ");
  const badges = [
    o.status === "favoriet" ? '<span class="badge badge-succes">★ Favoriet</span>' : "",
    o.status === "uitgesloten" ? '<span class="badge">Niet voor mij</span>' : "",
    o.knieGevoelig ? '<span class="badge badge-knie">Knie</span>' : "",
  ].join("");
  return `
    <li>
      <a class="lijst-rij bieb-rij" href="/bibliotheek.html?id=${encodeURIComponent(o.id)}">
        ${o.afbeelding ? `<img class="bieb-duim" src="${escapeHtml(o.afbeelding)}" alt="" loading="lazy" decoding="async" width="56" height="56" />` : '<span class="bieb-duim"></span>'}
        <span class="bieb-tekst"><strong>${escapeHtml(o.naam)}</strong><br /><span class="lijst-meta">${escapeHtml(meta)}</span>
        ${badges ? `<span class="bieb-badges">${badges}</span>` : ""}</span>
      </a>
    </li>`;
}

// ---------- Lijst ----------

function leesFilters() {
  const p = new URLSearchParams(location.search);
  zoekEl.value = p.get("zoek") ?? "";
  spierEl.value = p.get("spier") ?? "";
  materiaalEl.value = p.get("materiaal") ?? "";
  patroonEl.value = p.get("patroon") ?? "";
  knieEl.setAttribute("aria-pressed", String(p.get("knie") === "vriendelijk"));
  favEl.setAttribute("aria-pressed", String(p.get("lijst") === "favorieten"));
  uitEl.setAttribute("aria-pressed", String(p.get("lijst") === "uitgesloten"));
}

function filterQuery() {
  const p = new URLSearchParams();
  if (zoekEl.value.trim()) p.set("zoek", zoekEl.value.trim());
  if (spierEl.value) p.set("spier", spierEl.value);
  if (materiaalEl.value) p.set("materiaal", materiaalEl.value);
  if (patroonEl.value) p.set("patroon", patroonEl.value);
  if (knieEl.getAttribute("aria-pressed") === "true") p.set("knie", "vriendelijk");
  if (favEl.getAttribute("aria-pressed") === "true") p.set("lijst", "favorieten");
  else if (uitEl.getAttribute("aria-pressed") === "true") p.set("lijst", "uitgesloten");
  return p;
}

function vulOpties(select, waarden, eerste) {
  const huidig = select.value;
  select.innerHTML = `<option value="">${eerste}</option>${Object.entries(waarden)
    .map(([k, v]) => `<option value="${escapeHtml(k)}">${escapeHtml(v)}</option>`)
    .join("")}`;
  select.value = huidig;
}

async function laadLijst({ meer = false } = {}) {
  const nummer = ++laadVolgnummer;
  const query = filterQuery();
  history.replaceState(null, "", query.toString() ? `?${query}` : location.pathname);
  pagina = meer ? pagina + 1 : 1;
  query.set("pagina", String(pagina));
  const lijst = document.getElementById("resultaten");
  try {
    const data = await api(`/api/bibliotheek?${query}`);
    if (nummer !== laadVolgnummer) return; // er kwam intussen een nieuwere zoekopdracht
    if (!labels) {
      labels = data.labels;
      const { overig, ...patronen } = labels.patronen;
      vulOpties(spierEl, labels.spieren, "Alle");
      vulOpties(materiaalEl, labels.materiaal, "Alles");
      vulOpties(patroonEl, { ...patronen, overig }, "Alle bewegingen");
      leesFilters();
    }
    favEl.textContent = `★ Favorieten${data.aantallen.favorieten ? ` (${data.aantallen.favorieten})` : ""}`;
    uitEl.textContent = `Niet voor mij${data.aantallen.uitgesloten ? ` (${data.aantallen.uitgesloten})` : ""}`;
    document.getElementById("aantal").textContent =
      data.totaal === 0 ? "Niets gevonden. Probeer een ander woord of minder filters." : `${data.totaal} ${data.totaal === 1 ? "oefening" : "oefeningen"}`;
    const html = data.oefeningen.map(rijHtml).join("");
    if (meer) lijst.insertAdjacentHTML("beforeend", html);
    else lijst.innerHTML = html;
    document.getElementById("meer").hidden = data.pagina * data.perPagina >= data.totaal;
  } catch (fout) {
    if (nummer === laadVolgnummer) document.getElementById("aantal").textContent = foutTekst(fout);
  }
}

function startLijst() {
  document.getElementById("lijst-weergave").hidden = false;
  leesFilters();
  let wacht = null;
  zoekEl.addEventListener("input", () => {
    clearTimeout(wacht);
    wacht = setTimeout(() => laadLijst(), 250);
  });
  for (const el of [spierEl, materiaalEl, patroonEl]) el.addEventListener("change", () => laadLijst());
  knieEl.addEventListener("click", () => {
    knieEl.setAttribute("aria-pressed", String(knieEl.getAttribute("aria-pressed") !== "true"));
    laadLijst();
  });
  // Favorieten en "niet voor mij" sluiten elkaar uit.
  for (const [knop, ander] of [
    [favEl, uitEl],
    [uitEl, favEl],
  ]) {
    knop.addEventListener("click", () => {
      knop.setAttribute("aria-pressed", String(knop.getAttribute("aria-pressed") !== "true"));
      ander.setAttribute("aria-pressed", "false");
      laadLijst();
    });
  }
  document.getElementById("meer").addEventListener("click", () => laadLijst({ meer: true }));
  laadLijst();
}

// ---------- Eén oefening ----------

let detail = null;

function tekenStatus() {
  const fav = document.getElementById("knop-favoriet");
  const uit = document.getElementById("knop-uitgesloten");
  fav.setAttribute("aria-pressed", String(detail.status === "favoriet"));
  uit.setAttribute("aria-pressed", String(detail.status === "uitgesloten"));
  fav.textContent = detail.status === "favoriet" ? "★ Favoriet" : "☆ Favoriet";
}

async function zetStatus(status) {
  const nieuw = detail.status === status ? "geen" : status;
  document.getElementById("status-fout").textContent = "";
  try {
    detail.status = (await api(`/api/bibliotheek/${encodeURIComponent(detail.oefening.id)}/status`, { methode: "PUT", body: { status: nieuw } })).status;
    tekenStatus();
  } catch (fout) {
    document.getElementById("status-fout").textContent = foutTekst(fout);
  }
}

function tekenDetail() {
  const o = detail.oefening;
  const l = detail.labels;
  document.title = `${o.naam} — LuzeX RSLNT`;
  document.getElementById("detail-naam").textContent = o.naam;
  document.getElementById("detail-sub").textContent = [o.bronNaam !== o.naam ? o.bronNaam : null, o.categorie, o.niveau].filter(Boolean).join(" · ");

  document.getElementById("detail-fotos").innerHTML = o.afbeeldingen
    .map((src, i) => `<img src="${escapeHtml(src)}" alt="${o.naam}: ${i === 0 ? "begin" : "eind"} van de beweging" loading="lazy" decoding="async" />`)
    .join("");

  document.getElementById("detail-badges").innerHTML = [
    o.basislijst ? '<span class="badge badge-succes">Basislijst</span>' : "",
    o.knieGevoelig ? `<span class="badge badge-knie">Knie-gevoelig${o.knieGeschat ? " (geschat)" : ""}</span>` : "",
    o.schouderBelastend ? '<span class="badge">Vraagt veel van je schouders</span>' : "",
    o.rugBelastend ? '<span class="badge">Vraagt veel van je onderrug</span>' : "",
  ].join("");

  const feit = (label, waarde) =>
    waarde ? `<li class="lijst-rij"><span class="lijst-meta">${label}</span><strong class="waarde-rechts">${escapeHtml(waarde)}</strong></li>` : "";
  document.getElementById("detail-feiten").innerHTML = [
    feit("Hoofdspieren", o.spierenPrimair.map((s) => l.spieren[s] ?? s).join(", ")),
    feit("Hulpspieren", o.spierenSecundair.map((s) => l.spieren[s] ?? s).join(", ")),
    feit("Materiaal", l.materiaal[o.materiaal] ?? o.materiaal),
    feit("Beweging", o.patroon !== "overig" ? l.patronen[o.patroon] : null),
    feit("Type", o.mechaniek === "compound" ? "Meerdere gewrichten" : o.mechaniek === "isolation" ? "Eén gewricht" : null),
  ].join("");

  const cue = document.getElementById("detail-cue");
  cue.hidden = !o.cue;
  cue.textContent = o.cue ?? "";
  tekenStatus();

  document.getElementById("detail-uitleg").innerHTML = o.uitleg.length
    ? o.uitleg.map((stap) => `<li>${escapeHtml(stap)}</li>`).join("")
    : '<li class="lijst-meta" lang="nl">Geen uitleg in de bron.</li>';

  const inProgramma = document.getElementById("in-programma");
  inProgramma.textContent = detail.inProgramma.length
    ? `Staat in ${detail.inProgramma.map((s) => `${s.code} · ${s.naam}`).join(" en ")} van je actieve programma.`
    : "Staat nog niet in je actieve programma.";

  document.getElementById("vergelijkbaar-paneel").hidden = detail.vergelijkbaar.length === 0;
  labels = l;
  document.getElementById("vergelijkbaar").innerHTML = detail.vergelijkbaar.map(rijHtml).join("");
}

async function laadSchemas() {
  const select = document.getElementById("toevoegen-schema");
  try {
    const { schemas } = await api("/api/schemas");
    document.getElementById("toevoegen-blok").hidden = schemas.length === 0;
    select.innerHTML = schemas.map((s) => `<option value="${s.id}">${escapeHtml(s.code)} · ${escapeHtml(s.naam)}</option>`).join("");
  } catch {
    document.getElementById("toevoegen-blok").hidden = true;
  }
}

async function voegToe() {
  const knop = document.getElementById("toevoegen");
  const fout = document.getElementById("toevoegen-fout");
  const succes = document.getElementById("toevoegen-succes");
  fout.textContent = "";
  succes.textContent = "";
  knop.disabled = true;
  try {
    const res = await api(`/api/bibliotheek/${encodeURIComponent(detail.oefening.id)}/toevoegen`, {
      methode: "POST",
      body: { schemaId: document.getElementById("toevoegen-schema").value },
    });
    succes.textContent = `Toegevoegd aan ${res.schema.code} · ${res.schema.naam}.`;
    detail.inProgramma.push({ code: res.schema.code, naam: res.schema.naam });
    tekenDetail();
  } catch (f) {
    fout.textContent = foutTekst(f);
  } finally {
    knop.disabled = false;
  }
}

async function startDetail(id) {
  document.getElementById("detail-weergave").hidden = false;
  // Kom je uit de lijst, dan brengt "terug" je naar dezelfde zoekopdracht.
  const terug = document.getElementById("terug");
  terug.addEventListener("click", (e) => {
    if (document.referrer.startsWith(`${location.origin}/bibliotheek.html`) && history.length > 1) {
      e.preventDefault();
      history.back();
    }
  });
  document.getElementById("knop-favoriet").addEventListener("click", () => zetStatus("favoriet"));
  document.getElementById("knop-uitgesloten").addEventListener("click", () => zetStatus("uitgesloten"));
  document.getElementById("toevoegen").addEventListener("click", voegToe);
  try {
    detail = await api(`/api/bibliotheek/${encodeURIComponent(id)}`);
    tekenDetail();
    laadSchemas();
  } catch (fout) {
    document.getElementById("detail-naam").textContent = fout.status === 404 ? "Oefening niet gevonden" : foutTekst(fout);
  }
}

vereisSessie().then(() => {
  const id = queryParam("id");
  if (id) startDetail(id);
  else startLijst();
});
