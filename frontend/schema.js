// Schema-editor: de trainingen (A, B, C …) van het actieve programma, met sets, rep-range, RIR,
// rust, superset en cue per oefening; de oefeningenlijst met gewichtsstap; en programma's
// inladen uit een JSON-bestand. Een schema wordt in één keer opgeslagen (de hele lijst vervangt de oude).

const regelsEl = document.getElementById("regels");
const foutEl = document.getElementById("fout");
const succesEl = document.getElementById("succes");

const MATERIAAL_NAMEN = {
  dumbbell: "Dumbbell",
  barbell: "Stang",
  trap_bar: "Trap bar",
  kabel: "Kabel",
  machine: "Machine",
  lichaamsgewicht: "Lichaamsgewicht",
};
const STAP_PER_MATERIAAL = { dumbbell: 2, barbell: 2.5, trap_bar: 2.5, kabel: 2.5, machine: 2.5, lichaamsgewicht: 0 };
const GETALVELDEN = ["aantalSets", "minSets", "repsMin", "repsMax", "doelRir", "rustSeconden"];

let schemas = [];
let oefeningen = [];
let actiefId = null;
let regels = [];
let gewijzigd = false;

function regelsVan(schema) {
  return (schema?.oefeningen ?? []).map((r) => ({
    oefeningId: r.oefeningId,
    aantalSets: r.aantalSets,
    minSets: r.minSets,
    repsMin: r.repsMin,
    repsMax: r.repsMax,
    doelRir: r.doelRir,
    rustSeconden: r.rustSeconden,
    supersetGroep: r.supersetGroep ?? "",
    cue: r.cue ?? "",
  }));
}

// ---------- Schema ----------

function tekenTabs() {
  document.getElementById("tabs").innerHTML = schemas
    .map(
      (s) =>
        `<button type="button" data-schema="${s.id}" aria-pressed="${s.id === actiefId}">${escapeHtml(s.code)} · ${escapeHtml(s.naam)}</button>`,
    )
    .join("");
}

function veld(label, naam, waarde, i) {
  const modus =
    naam === "supersetGroep" ? 'autocomplete="off" maxlength="4"' : naam === "cue" ? 'autocomplete="off" maxlength="300"' : 'inputmode="numeric" autocomplete="off"';
  const klasse = naam === "cue" ? ' class="breed"' : "";
  return `<div${klasse}><label for="r${i}-${naam}">${label}</label><input id="r${i}-${naam}" data-veld="${naam}" ${modus} value="${escapeHtml(String(waarde ?? ""))}" /></div>`;
}

function tekenRegels() {
  if (regels.length === 0) {
    regelsEl.innerHTML = '<p class="lijst-meta">Nog geen oefeningen in dit schema.</p>';
    return;
  }
  regelsEl.innerHTML = regels
    .map((r, i) => {
      const opties = oefeningen
        .map((o) => `<option value="${o.id}"${o.id === r.oefeningId ? " selected" : ""}>${escapeHtml(o.naam)}</option>`)
        .join("");
      return `
        <div class="regel" data-index="${i}">
          <div class="regel-kop">
            <select data-veld="oefeningId" aria-label="Oefening ${i + 1}">${opties}</select>
            <button type="button" class="icoon-knop" data-actie="omhoog" aria-label="Omhoog"${i === 0 ? " disabled" : ""}>↑</button>
            <button type="button" class="icoon-knop" data-actie="omlaag" aria-label="Omlaag"${i === regels.length - 1 ? " disabled" : ""}>↓</button>
            <button type="button" class="icoon-knop" data-actie="weg" aria-label="Uit schema halen">×</button>
          </div>
          <div class="regel-velden">
            ${veld("Sets", "aantalSets", r.aantalSets, i)}
            ${veld("Min.", "minSets", r.minSets, i)}
            ${veld("Reps van", "repsMin", r.repsMin, i)}
            ${veld("Reps tot", "repsMax", r.repsMax, i)}
            ${veld("RIR", "doelRir", r.doelRir, i)}
            ${veld("Rust (s)", "rustSeconden", r.rustSeconden, i)}
            ${veld("Superset", "supersetGroep", r.supersetGroep, i)}
            ${veld("Cue", "cue", r.cue, i)}
          </div>
        </div>`;
    })
    .join("");
}

function kiesSchema(id) {
  if (gewijzigd && !confirm("Je wijzigingen in dit schema zijn nog niet opgeslagen. Weggooien?")) return;
  actiefId = id;
  regels = regelsVan(schemas.find((s) => s.id === id));
  gewijzigd = false;
  foutEl.textContent = "";
  succesEl.textContent = "";
  tekenTabs();
  tekenRegels();
}

document.getElementById("tabs").addEventListener("click", (e) => {
  const knop = e.target.closest("[data-schema]");
  if (knop && knop.dataset.schema !== actiefId) kiesSchema(knop.dataset.schema);
});

regelsEl.addEventListener("click", (e) => {
  const knop = e.target.closest("[data-actie]");
  if (!knop) return;
  const i = Number(knop.closest(".regel").dataset.index);
  if (knop.dataset.actie === "weg") regels.splice(i, 1);
  if (knop.dataset.actie === "omhoog" && i > 0) [regels[i - 1], regels[i]] = [regels[i], regels[i - 1]];
  if (knop.dataset.actie === "omlaag" && i < regels.length - 1) [regels[i + 1], regels[i]] = [regels[i], regels[i + 1]];
  gewijzigd = true;
  tekenRegels();
});

regelsEl.addEventListener("input", (e) => {
  const naam = e.target.dataset.veld;
  if (!naam) return;
  const r = regels[Number(e.target.closest(".regel").dataset.index)];
  r[naam] = GETALVELDEN.includes(naam) ? leesGetal(e.target.value) : e.target.value.trim();
  gewijzigd = true;
  succesEl.textContent = "";
});

document.getElementById("regel-toevoegen").addEventListener("click", () => {
  const vrij = oefeningen.find((o) => !regels.some((r) => r.oefeningId === o.id));
  if (!vrij) {
    foutEl.textContent = "Alle oefeningen staan al in dit schema. Voeg hieronder een nieuwe oefening toe.";
    return;
  }
  regels.push({
    oefeningId: vrij.id,
    aantalSets: 3,
    minSets: 3,
    repsMin: 8,
    repsMax: 12,
    doelRir: 2,
    rustSeconden: 90,
    supersetGroep: "",
    cue: "",
  });
  gewijzigd = true;
  tekenRegels();
});

document.getElementById("opslaan").addEventListener("click", async () => {
  foutEl.textContent = "";
  succesEl.textContent = "";
  const onvolledig = regels.findIndex((r) => ["aantalSets", "minSets", "repsMin", "repsMax"].some((v) => r[v] === null));
  if (onvolledig >= 0) {
    foutEl.textContent = `Regel ${onvolledig + 1}: vul sets en reps in.`;
    return;
  }
  try {
    await api(`/api/schemas/${actiefId}`, {
      methode: "PUT",
      body: { oefeningen: regels.map((r) => ({ ...r, supersetGroep: r.supersetGroep || null })) },
    });
    gewijzigd = false;
    await laadSchemas();
    succesEl.textContent = "Opgeslagen. Geldt vanaf je volgende training.";
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
});

window.addEventListener("beforeunload", (e) => {
  if (gewijzigd) e.preventDefault();
});

// ---------- Programma's ----------

const bestandEl = document.getElementById("programma-bestand");
const importKnop = document.getElementById("programma-importeren");
const programmaFout = document.getElementById("programma-fout");
const programmaSucces = document.getElementById("programma-succes");
let gekozenBestand = null;

function tekenProgrammas(programmas) {
  document.getElementById("programmas").innerHTML = programmas
    .map(
      (p) => `
      <li class="lijst-rij">
        <span><strong>${escapeHtml(p.naam)}</strong><br /><span class="lijst-meta">${p.schemas.map((s) => escapeHtml(s.code)).join(" · ")}${p.actief ? ` · actief sinds ${datumKort(p.startdatum)}` : ""}</span></span>
        <span class="knop-rij">
          ${p.heeftBron ? `<a class="text-link" href="/api/programmas/${p.id}/bestand" download>JSON</a>` : ""}
          ${p.actief ? '<span class="badge badge-succes">Actief</span>' : `<button type="button" class="text-link" data-activeer="${p.id}">Activeer</button>`}
        </span>
      </li>`,
    )
    .join("");
}

async function laadProgrammas() {
  const { programmas } = await api("/api/programmas");
  tekenProgrammas(programmas);
}

document.getElementById("programmas").addEventListener("click", async (e) => {
  const knop = e.target.closest("[data-activeer]");
  if (!knop) return;
  if (!confirm("Dit programma actief maken? Het begint opnieuw bij week 1, met de introfase.")) return;
  try {
    await api(`/api/programmas/${knop.dataset.activeer}/activeren`, { methode: "POST" });
    actiefId = null;
    await Promise.all([laadProgrammas(), laadSchemas()]);
  } catch (fout) {
    programmaFout.textContent = foutTekst(fout);
  }
});

// Bestand kiezen = meteen controleren, zodat je de fouten ziet voordat er iets verandert.
bestandEl.addEventListener("change", async () => {
  programmaFout.textContent = "";
  programmaSucces.textContent = "";
  importKnop.disabled = true;
  gekozenBestand = null;
  const bestand = bestandEl.files?.[0];
  if (!bestand) return;
  try {
    gekozenBestand = JSON.parse(await bestand.text());
  } catch {
    programmaFout.textContent = "Dit is geen geldig JSON-bestand.";
    return;
  }
  try {
    const { waarschuwingen } = await api("/api/programmas/import?controle=1", { methode: "POST", body: { bestand: gekozenBestand } });
    programmaSucces.textContent = `"${gekozenBestand.program.name}" klopt.${waarschuwingen.length ? ` Let op: ${waarschuwingen.join(" ")}` : ""}`;
    importKnop.disabled = false;
  } catch (fout) {
    const fouten = fout.data?.fouten;
    programmaFout.textContent = fouten ? fouten.join(" · ") : foutTekst(fout);
  }
});

importKnop.addEventListener("click", async () => {
  if (!gekozenBestand) return;
  importKnop.disabled = true;
  programmaFout.textContent = "";
  try {
    const { nieuw } = await api("/api/programmas/import", {
      methode: "POST",
      body: { bestand: gekozenBestand, activeren: document.getElementById("programma-activeren").checked },
    });
    programmaSucces.textContent = nieuw ? "Programma ingeladen." : "Programma bijgewerkt.";
    bestandEl.value = "";
    gekozenBestand = null;
    actiefId = null;
    await Promise.all([laadProgrammas(), laadOefeningen()]);
    await laadSchemas();
  } catch (fout) {
    programmaFout.textContent = foutTekst(fout);
    importKnop.disabled = false;
  }
});

// ---------- Oefeningen ----------

const oefeningForm = document.getElementById("oefening-form");
const oefeningFout = document.getElementById("oefening-fout");
const materiaalEl = document.getElementById("oefening-materiaal");
const stapEl = document.getElementById("oefening-stap");

function oefeningOmschrijving(o) {
  const stap = o.gewichtsstap <= 0 ? "geen gewicht" : `stap ${kg(o.gewichtsstap)}`;
  return `${MATERIAAL_NAMEN[o.materiaal] ?? o.materiaal} · ${stap}${o.perKant ? " · per kant" : ""}${o.knieGevoelig ? " · knie-gevoelig" : ""}`;
}

function tekenOefeningen() {
  document.getElementById("oefeningen").innerHTML = oefeningen
    .map(
      (o) => `
      <li class="lijst-rij">
        <span><strong>${escapeHtml(o.naam)}</strong><br /><span class="lijst-meta">${oefeningOmschrijving(o)}</span></span>
        <button type="button" class="text-link" data-wijzig="${o.id}">Wijzig</button>
      </li>`,
    )
    .join("");
}

function formulierLeeg() {
  oefeningForm.reset();
  document.getElementById("oefening-id").value = "";
  document.getElementById("oefening-form-titel").textContent = "Nieuwe oefening";
  document.getElementById("oefening-opslaan").textContent = "Oefening toevoegen";
  document.getElementById("oefening-annuleren").hidden = true;
  stapEl.value = getal(STAP_PER_MATERIAAL[materiaalEl.value]);
  oefeningFout.textContent = "";
}

materiaalEl.addEventListener("change", () => {
  stapEl.value = getal(STAP_PER_MATERIAAL[materiaalEl.value]);
});

document.getElementById("oefeningen").addEventListener("click", (e) => {
  const knop = e.target.closest("[data-wijzig]");
  if (!knop) return;
  const o = oefeningen.find((x) => x.id === knop.dataset.wijzig);
  document.getElementById("oefening-id").value = o.id;
  document.getElementById("oefening-naam").value = o.naam;
  materiaalEl.value = o.materiaal;
  stapEl.value = getal(o.gewichtsstap);
  document.getElementById("oefening-perkant").checked = o.perKant;
  document.getElementById("oefening-knie").checked = o.knieGevoelig;
  document.getElementById("oefening-form-titel").textContent = `${o.naam} wijzigen`;
  document.getElementById("oefening-opslaan").textContent = "Wijziging opslaan";
  document.getElementById("oefening-annuleren").hidden = false;
  oefeningForm.scrollIntoView({ behavior: "smooth", block: "center" });
});

document.getElementById("oefening-annuleren").addEventListener("click", formulierLeeg);

oefeningForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  oefeningFout.textContent = "";
  const id = document.getElementById("oefening-id").value;
  const body = {
    naam: document.getElementById("oefening-naam").value.trim(),
    materiaal: materiaalEl.value,
    gewichtsstap: leesGetal(stapEl.value),
    perKant: document.getElementById("oefening-perkant").checked,
    knieGevoelig: document.getElementById("oefening-knie").checked,
  };
  if (body.gewichtsstap === null) {
    oefeningFout.textContent = "Vul de kleinste gewichtsstap in, bijvoorbeeld 2,5 (0 = zonder gewicht).";
    return;
  }
  try {
    await api(id ? `/api/oefeningen/${id}` : "/api/oefeningen", { methode: id ? "PATCH" : "POST", body });
    await laadOefeningen();
    formulierLeeg();
    tekenRegels(); // de keuzelijsten krijgen de nieuwe naam
  } catch (fout) {
    oefeningFout.textContent = foutTekst(fout);
  }
});

// ---------- Laden ----------

async function laadSchemas() {
  const resultaat = await api("/api/schemas");
  schemas = resultaat.schemas;
  document.getElementById("programma-naam").textContent = resultaat.programma ? resultaat.programma.naam : "Geen actief programma";
  if (!gewijzigd) {
    if (!schemas.some((s) => s.id === actiefId)) actiefId = schemas[0]?.id ?? null;
    regels = regelsVan(schemas.find((s) => s.id === actiefId));
  }
  tekenTabs();
  tekenRegels();
}

async function laadOefeningen() {
  ({ oefeningen } = await api("/api/oefeningen"));
  tekenOefeningen();
}

(async () => {
  await vereisSessie();
  try {
    await laadOefeningen();
    await Promise.all([laadSchemas(), laadProgrammas()]);
    formulierLeeg();
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
})();
