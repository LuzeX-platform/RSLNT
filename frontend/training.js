// Het trainingsscherm. Eén kaart per oefening met wat je vorige keer deed, het voorstel en de
// sets. Alles wat je opslaat gaat via de offline-wachtrij (common.js): bij slecht bereik blijft
// het op je telefoon staan tot het weer kan.

const trainingId = queryParam("id");
const oefeningenEl = document.getElementById("oefeningen");
const foutEl = document.getElementById("fout");
const notitieEl = document.getElementById("notitie");
const afrondenKnop = document.getElementById("afronden");

let detail = null;
/** Per oefening (TrainingOefening-id) de rijen op het scherm. */
const rijenPer = new Map();
const opslaanTimers = new Map();
/** Oefeningen waarvan de wissellijst openstaat. */
const wisselOpen = new Set();

/** Waar het onderzoek achter een voorstel staat (wetenschap.html). */
function waaromAnker(v) {
  if (v.kniepijnRegel) return "kniepijn";
  if (v.actie === "terug") return "stagnatie";
  if (v.actie === "deload") return "deload";
  return "progressie";
}

/** Zonder gewichtsstap (dead bug) geen gewichtveld; een back extension met een schijf heeft er wel een. */
function isZonderGewicht(o) {
  return o.gewichtsstap <= 0;
}

function oefeningMetId(toId) {
  return detail.oefeningen.find((o) => o.id === toId);
}

function setPad(o, nummer) {
  return `/api/trainingen/${trainingId}/oefeningen/${o.id}/sets/${nummer}`;
}

// ---------- Teksten ----------

function doelTekst(o) {
  const sets = o.minSets < o.aantalSets ? `${o.minSets}–${o.aantalSets}` : `${o.aantalSets}`;
  const reps = o.repsMin === o.repsMax ? `${o.repsMax}` : `${o.repsMin}–${o.repsMax}`;
  return `${sets} × ${reps}${o.perKant ? " p/kant" : ""}`;
}

function minSec(seconden) {
  return `${Math.floor(seconden / 60)}:${String(seconden % 60).padStart(2, "0")}`;
}

/** "RIR 2 · rust 3:00" */
function doelMetaTekst(o) {
  const delen = [];
  if (o.doelRir !== null) delen.push(`RIR ${o.doelRir}`);
  if (o.rustSeconden) delen.push(`rust ${minSec(o.rustSeconden)}`);
  return delen.join(" · ");
}

function vorigeTekst(o) {
  if (!o.vorigeKeer) return "Nog niet eerder gedaan.";
  const sets = o.vorigeKeer.sets;
  const reps = sets.map((s) => s.reps).join(", ");
  const gewichten = [...new Set(sets.map((s) => s.gewicht))];
  let kern;
  if (isZonderGewicht(o) || gewichten.every((g) => g === null)) kern = `${reps} reps`;
  else if (gewichten.length === 1) kern = `${kg(gewichten[0])} × ${reps}`;
  else kern = sets.map((s) => `${getal(s.gewicht)}×${s.reps}`).join(", ") + " (kg×reps)";
  const rir = sets.some((s) => s.rir !== null) ? ` · RIR ${sets.map((s) => s.rir ?? "–").join("/")}` : "";
  const knie = sets.some((s) => s.kniepijn !== null) ? ` · knie ${sets.map((s) => s.kniepijn ?? "–").join("/")}` : "";
  return `<strong>Vorige keer</strong> (${datumKort(o.vorigeKeer.datum)}): ${escapeHtml(kern + rir + knie)}`;
}

function voorstelWaarde(v) {
  switch (v.actie) {
    case "omhoog":
      return `↑ ${kg(v.gewicht)}`;
    case "terug":
      return v.gewicht === null ? "↓ Rustiger" : `↓ ${kg(v.gewicht)}`;
    case "gelijk":
      return v.gewicht === null ? "= Zelfde" : `= ${kg(v.gewicht)}`;
    case "moeilijker":
      return "↑ Moeilijker";
    case "deload":
      return v.gewicht === null ? "Deload" : `Deload · ${kg(v.gewicht)}`;
    default:
      return "Eerste keer";
  }
}

function voorstelHtml(v) {
  return `
    <div class="voorstel voorstel-${v.actie}">
      <span class="voorstel-waarde">${voorstelWaarde(v)}</span>
      <span class="voorstel-reden">${escapeHtml(v.reden)} <a class="waarom" href="/wetenschap.html#${waaromAnker(v)}">Waarom?</a></span>
    </div>`;
}

// ---------- Rijen (sets) ----------

function werkgewichtVorigeKeer(o) {
  const gewichten = (o.vorigeKeer?.sets ?? []).map((s) => s.gewicht).filter((g) => g !== null);
  return gewichten.length ? Math.min(...gewichten) : null;
}

/** Wat er in een nog niet opgeslagen set vooraf staat. */
function beginwaarden(o, nummer, vorigeRij) {
  let gewicht = null;
  if (!isZonderGewicht(o)) {
    gewicht = vorigeRij?.gewicht ?? o.voorstel.gewicht ?? werkgewichtVorigeKeer(o);
  }
  // Zelfde gewicht als vorige keer: begin bij wat je toen haalde, dan weet je wat je moet verbeteren.
  const vorigeSet = o.vorigeKeer?.sets.find((s) => s.nummer === nummer);
  const reps = o.voorstel.actie === "gelijk" && vorigeSet ? vorigeSet.reps : vorigeRij?.reps ?? o.repsMin;
  return { nummer, gewicht, reps, rir: null, kniepijn: null, opgeslagen: false, aangeraakt: false, knieOpen: false };
}

function maakRijen(o) {
  const opgeslagen = new Map(o.sets.map((s) => [s.nummer, s]));
  const aantal = Math.max(o.aantalSets, ...o.sets.map((s) => s.nummer));
  const rijen = [];
  for (let nummer = 1; nummer <= aantal; nummer++) {
    const s = opgeslagen.get(nummer);
    rijen.push(
      s
        ? { ...s, opgeslagen: true, aangeraakt: true, knieOpen: s.kniepijn !== null }
        : beginwaarden(o, nummer, rijen[rijen.length - 1]),
    );
  }
  return rijen;
}

function keuzesHtml(rij, veld, max) {
  const knoppen = [];
  for (let i = 0; i <= max; i++) {
    const klasse = veld === "kniepijn" && i >= 4 ? "keuze pijn-grens" : "keuze";
    knoppen.push(
      `<button type="button" class="${klasse}" data-actie="${veld}" data-waarde="${i}" aria-pressed="${rij[veld] === i}">${i}</button>`,
    );
  }
  return knoppen.join("");
}

function setHtml(o, rij) {
  const lg = isZonderGewicht(o);
  const gewichtVeld = lg
    ? ""
    : `<div>
        <span class="veld-label">Gewicht (kg)</span>
        <div class="stepper">
          <button type="button" data-actie="gewicht-min" aria-label="Gewicht omlaag">−</button>
          <input data-veld="gewicht" inputmode="decimal" autocomplete="off" aria-label="Gewicht set ${rij.nummer} in kg"
                 value="${rij.gewicht === null ? "" : getal(rij.gewicht)}" placeholder="kg" />
          <button type="button" data-actie="gewicht-plus" aria-label="Gewicht omhoog">+</button>
        </div>
      </div>`;
  const knieTekst = rij.kniepijn === null ? "–" : rij.kniepijn;
  return `
    <div class="set${rij.opgeslagen ? " opgeslagen" : ""}" data-to="${o.id}" data-nummer="${rij.nummer}">
      <div class="set-kop">
        <span class="set-nummer">Set ${rij.nummer}${rij.nummer > o.aantalSets ? " (extra)" : ""}</span>
        <button type="button" class="secondary knie-knop" data-actie="knie-open" aria-expanded="${rij.knieOpen}">Knie ${knieTekst}</button>
      </div>
      <div class="set-velden${lg ? " enkel" : ""}">
        ${gewichtVeld}
        <div>
          <span class="veld-label">Reps${o.perKant ? " p/kant" : ""}</span>
          <div class="stepper">
            <button type="button" data-actie="reps-min" aria-label="Reps omlaag">−</button>
            <input data-veld="reps" inputmode="numeric" autocomplete="off" aria-label="Reps set ${rij.nummer}"
                   value="${rij.reps ?? ""}" />
            <button type="button" data-actie="reps-plus" aria-label="Reps omhoog">+</button>
          </div>
        </div>
      </div>
      <div class="keuze-rij">
        <span class="veld-label">RIR</span>
        <div class="keuzes" role="group" aria-label="Reps in reserve">${keuzesHtml(rij, "rir", 4)}</div>
      </div>
      <div class="keuze-rij" ${rij.knieOpen ? "" : "hidden"}>
        <span class="veld-label">Knie</span>
        <div class="keuzes schaal-11" role="group" aria-label="Kniepijn 0 tot 10">${keuzesHtml(rij, "kniepijn", 10)}</div>
      </div>
      <div class="set-acties">
        <button type="button" class="opslaan" data-actie="opslaan">Set ${rij.nummer} opslaan</button>
        ${rij.opgeslagen ? '<span class="set-status">Opgeslagen</span><button type="button" class="text-link gevaar-link" data-actie="wissen">Wis set</button>' : ""}
      </div>
    </div>`;
}

function wisselHtml(o) {
  const rijen = rijenPer.get(o.id);
  const kanWisselen = detail.training.status === "bezig" && o.alternatieven.length > 0 && !rijen.some((r) => r.opgeslagen);
  if (!kanWisselen) return "";
  if (!wisselOpen.has(o.id)) {
    return `<button type="button" class="text-link wissel-knop" data-actie="wissel-open">⇄ ${o.gewisseld ? "Andere oefening" : "Wisselen (machine bezet?)"}</button>`;
  }
  const knoppen = o.alternatieven
    .map((a) => `<button type="button" class="secondary" data-actie="wissel-naar" data-oefening="${a.id}">${escapeHtml(a.naam)}</button>`)
    .join("");
  return `
    <div class="wissel-lijst">
      <span class="veld-label">Wisselen voor vandaag</span>
      <div class="knop-rij">${knoppen}<button type="button" class="text-link" data-actie="wissel-open">Annuleren</button></div>
    </div>`;
}

function oefeningHtml(o) {
  const rijen = rijenPer.get(o.id);
  const badges = [
    o.supersetGroep ? `<span class="badge superset-badge">Superset ${escapeHtml(o.supersetGroep)}</span>` : "",
    o.knieGevoelig ? '<span class="badge badge-knie">Knie-gevoelig</span>' : "",
    o.gewisseld ? `<span class="badge">In plaats van ${escapeHtml(o.gewisseld.van)}</span>` : "",
  ].join("");
  const meta = doelMetaTekst(o);
  return `
    <section class="panel oefening" id="oefening-${o.id}" data-to="${o.id}">
      <div class="oefening-kop">
        <h2>${escapeHtml(o.naam)}</h2>
        <span class="doel">${doelTekst(o)}</span>
      </div>
      ${meta || o.bibliotheekId ? `<p class="doel-meta">${meta}${meta && o.bibliotheekId ? " · " : ""}${
        o.bibliotheekId ? `<a class="waarom" href="/bibliotheek.html?id=${encodeURIComponent(o.bibliotheekId)}">Uitleg en foto's</a>` : ""
      }</p>` : ""}
      ${badges.trim() ? `<div class="oefening-badges">${badges}</div>` : ""}
      ${o.cue ? `<p class="cue">${escapeHtml(o.cue)}</p>` : ""}
      ${wisselHtml(o)}
      <p class="vorige">${vorigeTekst(o)}</p>
      ${voorstelHtml(o.voorstel)}
      <div class="sets">${rijen.map((rij) => setHtml(o, rij)).join("")}</div>
      <button type="button" class="secondary set-extra" data-actie="extra-set">+ Extra set</button>
    </section>`;
}

/** Tekent één set opnieuw (na een tik); invoervelden met focus laten we met rust. */
function tekenSet(o, rij) {
  const oud = oefeningenEl.querySelector(`.set[data-to="${o.id}"][data-nummer="${rij.nummer}"]`);
  const sjabloon = document.createElement("template");
  sjabloon.innerHTML = setHtml(o, rij).trim();
  if (oud) oud.replaceWith(sjabloon.content.firstChild);
  else oefeningenEl.querySelector(`#oefening-${o.id} .sets`).append(sjabloon.content.firstChild);
}

// ---------- Opslaan ----------

function verstuurSet(o, rij) {
  return verstuurViaWachtrij({
    sleutel: `set:${o.id}:${rij.nummer}`,
    pad: setPad(o, rij.nummer),
    methode: "PUT",
    body: { gewicht: isZonderGewicht(o) ? null : rij.gewicht, reps: rij.reps, rir: rij.rir, kniepijn: rij.kniepijn },
  });
}

function controleer(o, rij) {
  if (!isZonderGewicht(o) && (rij.gewicht === null || rij.gewicht < 0)) return "Vul een gewicht in.";
  if (rij.reps === null || rij.reps < 0 || !Number.isInteger(rij.reps)) return "Vul het aantal reps in.";
  return null;
}

/** Een al opgeslagen set die je aanpast, wordt na een korte pauze opnieuw bewaard. */
function bewaarStraks(o, rij) {
  if (!rij.opgeslagen) return;
  const sleutel = `${o.id}:${rij.nummer}`;
  clearTimeout(opslaanTimers.get(sleutel));
  opslaanTimers.set(
    sleutel,
    setTimeout(() => {
      if (!controleer(o, rij)) verstuurSet(o, rij);
    }, 600),
  );
}

function slaOp(o, rij) {
  const probleem = controleer(o, rij);
  if (probleem) {
    foutEl.textContent = `${o.naam}, set ${rij.nummer}: ${probleem}`;
    return;
  }
  foutEl.textContent = "";
  rij.opgeslagen = true;
  rij.aangeraakt = true;
  verstuurSet(o, rij);
  tekenSet(o, rij);
  tekenTeller();

  // De volgende set neemt het gewicht en de reps over, zolang je die nog niet zelf hebt aangepast.
  const rijen = rijenPer.get(o.id);
  const volgende = rijen.find((r) => r.nummer === rij.nummer + 1);
  if (volgende && !volgende.opgeslagen && !volgende.aangeraakt) {
    if (!isZonderGewicht(o)) volgende.gewicht = rij.gewicht;
    tekenSet(o, volgende);
  }
  scrollNaarVolgende(o, rij);
  startRust(o);
}

/** Na een set: door naar de volgende open set, of naar de volgende oefening. Eén hand, geen gescroll. */
function scrollNaarVolgende(o, rij) {
  const open = rijenPer.get(o.id).find((r) => r.nummer > rij.nummer && !r.opgeslagen);
  const doel = open
    ? oefeningenEl.querySelector(`.set[data-to="${o.id}"][data-nummer="${open.nummer}"]`)
    : document.getElementById(`oefening-${o.id}`)?.nextElementSibling;
  doel?.scrollIntoView({ behavior: "smooth", block: open ? "center" : "start" });
}

// ---------- Interactie ----------

function rijVan(element) {
  const setEl = element.closest(".set");
  if (!setEl) return null;
  const o = oefeningMetId(setEl.dataset.to);
  const rij = rijenPer.get(o.id).find((r) => r.nummer === Number(setEl.dataset.nummer));
  return { o, rij };
}

oefeningenEl.addEventListener("click", (e) => {
  const knop = e.target.closest("[data-actie]");
  if (!knop) return;
  const actie = knop.dataset.actie;

  if (actie === "wissel-open" || actie === "wissel-naar") {
    const o = oefeningMetId(knop.closest(".oefening").dataset.to);
    if (actie === "wissel-open") {
      if (wisselOpen.has(o.id)) wisselOpen.delete(o.id);
      else wisselOpen.add(o.id);
      teken();
      return;
    }
    wissel(o, knop.dataset.oefening);
    return;
  }

  if (actie === "extra-set") {
    const o = oefeningMetId(knop.closest(".oefening").dataset.to);
    const rijen = rijenPer.get(o.id);
    const laatste = rijen[rijen.length - 1];
    const rij = beginwaarden(o, (laatste?.nummer ?? 0) + 1, laatste);
    rijen.push(rij);
    tekenSet(o, rij);
    return;
  }

  const gevonden = rijVan(knop);
  if (!gevonden) return;
  const { o, rij } = gevonden;

  switch (actie) {
    case "gewicht-min":
    case "gewicht-plus": {
      const stap = o.gewichtsstap || 1;
      const huidig = rij.gewicht ?? werkgewichtVorigeKeer(o) ?? 0;
      rij.gewicht = Math.max(0, Math.round((huidig + (actie === "gewicht-plus" ? stap : -stap)) * 100) / 100);
      break;
    }
    case "reps-min":
    case "reps-plus":
      rij.reps = Math.max(0, (rij.reps ?? 0) + (actie === "reps-plus" ? 1 : -1));
      break;
    case "rir":
    case "kniepijn": {
      const waarde = Number(knop.dataset.waarde);
      rij[actie] = rij[actie] === waarde ? null : waarde; // nog eens tikken = leegmaken
      break;
    }
    case "knie-open":
      rij.knieOpen = !rij.knieOpen;
      tekenSet(o, rij);
      return;
    case "opslaan":
      slaOp(o, rij);
      return;
    case "wissen":
      rij.opgeslagen = false;
      verstuurViaWachtrij({ sleutel: `set:${o.id}:${rij.nummer}`, pad: setPad(o, rij.nummer), methode: "DELETE" });
      tekenSet(o, rij);
      tekenTeller();
      return;
    default:
      return;
  }
  rij.aangeraakt = true;
  tekenSet(o, rij);
  bewaarStraks(o, rij);
});

oefeningenEl.addEventListener("input", (e) => {
  const veld = e.target.dataset?.veld;
  if (!veld) return;
  const { o, rij } = rijVan(e.target);
  const waarde = leesGetal(e.target.value);
  rij[veld] = veld === "reps" && waarde !== null ? Math.round(waarde) : waarde;
  rij.aangeraakt = true;
  bewaarStraks(o, rij);
});

// Na het typen het getal netjes in Nederlandse notatie terugzetten. Bewust alleen de waarde en
// niet de hele set opnieuw tekenen: dan zou de tik op "+" die de focus wegneemt verloren gaan.
oefeningenEl.addEventListener("focusout", (e) => {
  const veld = e.target.dataset?.veld;
  if (!veld) return;
  const gevonden = rijVan(e.target);
  if (!gevonden) return;
  const waarde = gevonden.rij[veld];
  e.target.value = waarde === null ? "" : veld === "gewicht" ? getal(waarde) : String(waarde);
});

let notitieTimer;
notitieEl.addEventListener("input", () => {
  clearTimeout(notitieTimer);
  notitieTimer = setTimeout(() => {
    verstuurViaWachtrij({
      sleutel: `notitie:${trainingId}`,
      pad: `/api/trainingen/${trainingId}`,
      methode: "PATCH",
      body: { notitie: notitieEl.value },
    });
  }, 800);
});

window.addEventListener("wachtrij-fout", (e) => {
  foutEl.textContent = `Niet opgeslagen: ${e.detail.bericht}`;
});

// ---------- Wisselen ----------

/** Wisselen moet direct naar de server: het voorstel en "vorige keer" horen bij de nieuwe oefening. */
async function wissel(o, oefeningId) {
  foutEl.textContent = "";
  try {
    detail = await api(`/api/trainingen/${trainingId}/oefeningen/${o.id}/wissel`, {
      methode: "PATCH",
      body: { oefeningId }, // terug naar de oefening uit het schema herkent de server zelf
    });
    pasWachtrijToe();
    wisselOpen.delete(o.id);
    rijenPer.delete(o.id);
    teken();
    document.getElementById(`oefening-${o.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
}

// ---------- Rusttimer ----------
// Start na elke opgeslagen set met de rusttijd van die oefening. Rekent met een eindtijd, zodat
// hij klopt als je telefoon even op slot gaat. Trillen kan niet op een iPhone (Safari ondersteunt
// dat niet); daar klinkt een kort signaal.

const rustEl = document.createElement("div");
rustEl.className = "rusttimer";
rustEl.hidden = true;
rustEl.setAttribute("role", "timer");
rustEl.innerHTML = `
  <span class="rust-tekst"><span class="rust-label"></span><span class="rust-tijd"></span></span>
  <button type="button" class="secondary" data-rust="erbij">+30 s</button>
  <button type="button" data-rust="stop">Stop</button>`;
document.body.append(rustEl);

let rust = null;
let geluid = null;

function startRust(o) {
  if (!o.rustSeconden) return;
  // Het geluid moet tijdens een tik worden klaargezet, anders blijft het op iOS stil.
  try {
    geluid ??= new AudioContext();
    geluid.resume();
  } catch {
    geluid = null;
  }
  clearInterval(rust?.interval);
  rust = { eind: Date.now() + o.rustSeconden * 1000, naam: o.naam, klaar: false };
  rust.interval = setInterval(tekenRust, 250);
  tekenRust();
}

function stopRust() {
  clearInterval(rust?.interval);
  rust = null;
  rustEl.hidden = true;
}

function signaal() {
  navigator.vibrate?.([200, 100, 200]);
  if (!geluid) return;
  for (const start of [0, 0.25]) {
    const toon = geluid.createOscillator();
    const volume = geluid.createGain();
    toon.frequency.value = 880;
    volume.gain.value = 0.15;
    toon.connect(volume).connect(geluid.destination);
    toon.start(geluid.currentTime + start);
    toon.stop(geluid.currentTime + start + 0.15);
  }
}

function tekenRust() {
  if (!rust) return;
  const over = Math.ceil((rust.eind - Date.now()) / 1000);
  if (over <= 0 && !rust.klaar) {
    rust.klaar = true;
    signaal();
  }
  if (over <= -30) {
    stopRust(); // na een halve minuut "klaar" vanzelf weg
    return;
  }
  rustEl.hidden = false;
  rustEl.classList.toggle("klaar", over <= 0);
  rustEl.querySelector(".rust-label").textContent = over > 0 ? `Rust · ${rust.naam}` : "Tijd voor je volgende set";
  rustEl.querySelector(".rust-tijd").textContent = over > 0 ? minSec(over) : "";
  rustEl.querySelector('[data-rust="erbij"]').hidden = over <= 0;
  rustEl.querySelector('[data-rust="stop"]').textContent = over > 0 ? "Stop" : "OK";
}

rustEl.addEventListener("click", (e) => {
  const knop = e.target.closest("[data-rust]");
  if (!knop || !rust) return;
  if (knop.dataset.rust === "erbij") {
    rust.eind += 30000;
    tekenRust();
  } else {
    stopRust();
  }
});

// ---------- Afronden, heropenen, verwijderen ----------

afrondenKnop.addEventListener("click", async () => {
  foutEl.textContent = "";
  const nietOpgeslagen = [...rijenPer.values()].flat().filter((r) => r.aangeraakt && !r.opgeslagen).length;
  if (nietOpgeslagen && !confirm(`${nietOpgeslagen} set(s) heb je aangepast maar niet opgeslagen. Toch afronden?`)) return;

  afrondenKnop.disabled = true;
  clearTimeout(notitieTimer);
  // Eerst alles wat nog in de wachtrij staat, zodat de server de hele training kent.
  await verwerkWachtrij();
  if (leesWachtrij().length > 0) {
    verstuurViaWachtrij({ sleutel: `afronden:${trainingId}`, pad: `/api/trainingen/${trainingId}/afronden`, methode: "POST" });
    foutEl.textContent = "Geen verbinding: de training wordt afgerond zodra er weer bereik is.";
    afrondenKnop.disabled = false;
    return;
  }
  try {
    detail = await api(`/api/trainingen/${trainingId}/afronden`, { methode: "POST" });
    teken();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  } finally {
    afrondenKnop.disabled = false;
  }
});

document.getElementById("heropenen").addEventListener("click", async () => {
  try {
    await api(`/api/trainingen/${trainingId}/heropenen`, { methode: "POST" });
    await laad();
  } catch (fout) {
    foutEl.textContent = fout.status === 409 ? "Er is al een andere training bezig." : foutTekst(fout);
  }
});

document.getElementById("verwijderen").addEventListener("click", async () => {
  if (!confirm("Deze training en alle sets definitief verwijderen?")) return;
  try {
    await api(`/api/trainingen/${trainingId}`, { methode: "DELETE" });
    window.location.href = "/";
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
});

// ---------- Laden en tekenen ----------

function tekenTeller() {
  const gelogd = [...rijenPer.values()].flat().filter((r) => r.opgeslagen).length;
  const gepland = detail.oefeningen.reduce((som, o) => som + o.aantalSets, 0);
  document.getElementById("ondertitel").textContent = `${datumKort(detail.training.datum)} · ${gelogd} van ${gepland} sets`;
}

/** Sets die nog in de offline-wachtrij staan, alvast tonen alsof ze bewaard zijn. */
function pasWachtrijToe() {
  for (const item of leesWachtrij()) {
    const [soort, toId, nummer] = item.sleutel.split(":");
    if (soort !== "set") continue;
    const o = detail.oefeningen.find((x) => x.id === toId);
    if (!o) continue;
    o.sets = o.sets.filter((s) => s.nummer !== Number(nummer));
    if (item.methode === "PUT") o.sets.push({ nummer: Number(nummer), ...item.body });
    o.sets.sort((a, b) => a.nummer - b.nummer);
  }
  const notitie = leesWachtrij().find((i) => i.sleutel === `notitie:${trainingId}`);
  if (notitie) detail.training.notitie = notitie.body.notitie;
}

/** Introfase of deload, en het opwarmen, bovenaan de training. */
function tekenFase(training, afgerond) {
  const paneel = document.getElementById("fase-paneel");
  const delen = [];
  if (training.fase === "intro") {
    delen.push(`<p><strong>Introfase · week ${training.week}.</strong> Minder sets en ruim reps over, zodat je pezen en knieën kunnen wennen. <a class="waarom" href="/wetenschap.html#introfase">Waarom?</a></p>`);
  }
  if (training.fase === "deload") {
    delen.push('<p><strong>Deloadweek.</strong> Halve sets, zelfde gewicht. Herstellen hoort bij trainen. <a class="waarom" href="/wetenschap.html#deload">Waarom?</a></p>');
  }
  if (training.opwarmen && !afgerond) delen.push(`<p><strong>Opwarmen:</strong> ${escapeHtml(training.opwarmen)}</p>`);
  paneel.innerHTML = delen.join("");
  paneel.hidden = delen.length === 0;
  paneel.classList.toggle("fase-deload", training.fase === "deload");
}

function teken() {
  const { training, oefeningen } = detail;
  const afgerond = training.status === "afgerond";
  document.title = `${training.schemaNaam} — LuzeX RSLNT`;
  document.getElementById("kicker").textContent = `${afgerond ? "Afgerond" : "Bezig"} · Training ${training.schemaCode}`;
  document.getElementById("kop").textContent = training.schemaNaam;
  tekenFase(training, afgerond);

  // Rijen alleen opnieuw opbouwen bij het laden, niet na afronden: dan blijft wat er staat staan.
  for (const o of oefeningen) if (!rijenPer.has(o.id)) rijenPer.set(o.id, maakRijen(o));
  oefeningenEl.innerHTML = oefeningen.map(oefeningHtml).join("");
  tekenTeller();

  const vooruitblik = document.getElementById("vooruitblik");
  vooruitblik.hidden = !afgerond;
  if (afgerond) {
    const gedaan = oefeningen.filter((o) => o.volgendeKeer.actie !== "eerste_keer");
    const rij = (o) => `
      <li>
        <a class="lijst-rij" href="#oefening-${o.id}">
          <span><strong>${escapeHtml(o.naam)}</strong><br /><span class="lijst-meta">${escapeHtml(o.volgendeKeer.reden)}</span></span>
          <span class="voorstel-waarde kleur-${o.volgendeKeer.actie}">${voorstelWaarde(o.volgendeKeer)}</span>
        </a>
      </li>`;
    document.getElementById("vooruitblik-lijst").innerHTML = gedaan.length
      ? gedaan.map(rij).join("")
      : '<li class="lijst-meta">Nog niets gelogd in deze training.</li>';
  }

  document.getElementById("notitie-paneel").hidden = false;
  if (document.activeElement !== notitieEl) notitieEl.value = training.notitie;
  afrondenKnop.hidden = afgerond;
  document.getElementById("beheer").hidden = false;
  document.getElementById("heropenen").hidden = !afgerond;
}

async function laad() {
  if (!trainingId) {
    window.location.href = "/";
    return;
  }
  await vereisSessie();
  try {
    detail = await api(`/api/trainingen/${trainingId}`);
    pasWachtrijToe();
    rijenPer.clear();
    teken();
  } catch (fout) {
    document.getElementById("kop").textContent = fout.status === 404 ? "Training niet gevonden" : "Kon de training niet laden";
    foutEl.textContent = fout.status === 404 ? "" : foutTekst(fout);
  }
}

laad();
