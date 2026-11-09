// De weekplanner: per dag een training (of rust) en een tijd. Elke wijziging wordt meteen
// bewaard. Daaronder het agenda-abonnement (iCal) voor Apple Agenda en andere agenda's.

const KORT = (dag) => new Date(`${dag}T12:00:00`).toLocaleDateString("nl-NL", { day: "numeric", month: "short" });
const GROOT = (s) => s.charAt(0).toUpperCase() + s.slice(1);
let plan = null;
let meldingTimer = null;

function meld(tekst) {
  const el = document.getElementById("opgeslagen");
  el.textContent = tekst;
  clearTimeout(meldingTimer);
  meldingTimer = setTimeout(() => (el.textContent = ""), 2000);
}

/** Tijden per kwartier, 24-uurs: overal hetzelfde, ook waar een tijdveld 12-uurs zou tonen. */
function tijdOpties(gekozen) {
  const tijden = [];
  for (let m = 5 * 60; m <= 23 * 60; m += 15) tijden.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  if (!tijden.includes(gekozen)) tijden.push(gekozen);
  return tijden.sort().map((t) => `<option value="${t}"${t === gekozen ? " selected" : ""}>${t}</option>`).join("");
}

function dagHtml(d) {
  const isVandaag = d.datum === plan.vandaag;
  const opties = [`<option value="">Rust</option>`, ...plan.schemas.map((s) => `<option value="${s.id}"${s.id === d.schemaId ? " selected" : ""}>${escapeHtml(s.naam)}</option>`)].join("");
  const gedaan = d.gedaan.map((t) => `<span class="badge badge-succes">✓ ${escapeHtml(t.naam)}</span>`).join(" ");
  return `
    <li class="week-dag${isVandaag ? " vandaag" : ""}${d.schemaId ? "" : " rust"}">
      <div class="week-dag-kop">
        <strong>${GROOT(d.naam)}</strong>
        <span class="lijst-meta">${isVandaag ? "vandaag" : KORT(d.datum)}</span>
        ${gedaan}
      </div>
      <div class="week-dag-velden">
        <select data-weekdag="${d.weekdag}" aria-label="Training op ${d.naam}">${opties}</select>
        <select data-tijd="${d.weekdag}" aria-label="Hoe laat op ${d.naam}" ${d.schemaId ? "" : "hidden"}>${tijdOpties(d.tijd)}</select>
      </div>
    </li>`;
}

function tekenWeek() {
  const lijst = document.getElementById("week");
  if (!plan.programma) {
    document.getElementById("ondertitel").innerHTML = 'Je hebt nog geen schema. <a href="/start.html">Maak eerst een schema</a>, dan zet RSLNT het meteen over de week.';
    lijst.innerHTML = "";
    document.getElementById("verdeel").hidden = true;
    return;
  }
  const aantal = plan.dagen.filter((d) => d.schemaId).length;
  document.getElementById("ondertitel").textContent = aantal
    ? `${aantal} trainingen per week uit ${plan.programma.naam}. Kies per dag welke training je doet; Vandaag en je agenda volgen dit.`
    : `Nog niets ingepland. Kies per dag een training uit ${plan.programma.naam}, of verdeel ze in één keer.`;
  lijst.innerHTML = plan.dagen.map(dagHtml).join("");
}

function tekenAgenda(link) {
  const el = document.getElementById("agenda");
  document.getElementById("agenda-paneel").hidden = !plan.programma;
  if (link) {
    el.innerHTML = `
      <a class="knop-link knop-groot" href="${escapeHtml(link.webcal)}">Zet in Apple Agenda</a>
      <ol class="agenda-stappen">
        <li>Tik op de knop en kies <strong>Abonneer</strong>. Je trainingen staan dan in een eigen agenda "RSLNT trainingen".</li>
        <li>Google Agenda of Outlook? Kopieer de link en voeg hem toe via <em>Andere agenda's → Via URL</em>.</li>
      </ol>
      <div class="knop-rij">
        <button type="button" class="secondary" id="agenda-kopieer">Kopieer link</button>
        <button type="button" class="text-link gevaar-link" id="agenda-stop">Stop</button>
      </div>`;
    document.getElementById("agenda-kopieer").addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(link.https);
        meld("Link gekopieerd.");
      } catch {
        prompt("Kopieer deze link:", link.https);
      }
    });
  } else if (plan.agenda.actief) {
    el.innerHTML = `
      <p><strong>Je agenda-abonnement staat aan.</strong> Link kwijt of op een ander apparaat nodig? Maak een nieuwe; de oude stopt dan.</p>
      <div class="knop-rij">
        <button type="button" id="agenda-maak">Nieuwe link maken</button>
        <button type="button" class="text-link gevaar-link" id="agenda-stop">Stop</button>
      </div>`;
  } else {
    el.innerHTML = '<button type="button" class="knop-groot" id="agenda-maak">Zet mijn trainingen in mijn agenda</button>';
  }
  document.getElementById("agenda-maak")?.addEventListener("click", maakLink);
  document.getElementById("agenda-stop")?.addEventListener("click", stopAgenda);
}

async function maakLink() {
  const fout = document.getElementById("agenda-fout");
  fout.textContent = "";
  if (plan.agenda.actief && !confirm("Een nieuwe link maken? Agenda's met de oude link krijgen dan geen updates meer.")) return;
  try {
    const link = await api("/api/agenda", { methode: "POST" });
    plan.agenda.actief = true;
    tekenAgenda(link);
  } catch (f) {
    fout.textContent = foutTekst(f);
  }
}

async function stopAgenda() {
  if (!confirm("Het agenda-abonnement stoppen? De afspraken verdwijnen bij de volgende verversing uit je agenda; het abonnement zelf verwijder je in je agenda-app.")) return;
  try {
    await api("/api/agenda", { methode: "DELETE" });
    plan.agenda.actief = false;
    tekenAgenda(null);
  } catch (f) {
    document.getElementById("agenda-fout").textContent = foutTekst(f);
  }
}

async function bewaarDag(weekdag) {
  const select = document.querySelector(`select[data-weekdag="${weekdag}"]`);
  const tijd = document.querySelector(`select[data-tijd="${weekdag}"]`);
  const fout = document.getElementById("fout");
  fout.textContent = "";
  try {
    await api(`/api/planning/${weekdag}`, { methode: "PUT", body: { schemaId: select.value || null, ...(select.value && tijd.value ? { tijd: tijd.value } : {}) } });
    await laad(false);
    meld("Opgeslagen.");
  } catch (f) {
    fout.textContent = foutTekst(f);
  }
}

document.getElementById("week").addEventListener("change", (e) => {
  const weekdag = e.target.dataset.weekdag ?? e.target.dataset.tijd;
  if (weekdag) bewaarDag(weekdag);
});

document.getElementById("verdeel").addEventListener("click", async () => {
  if (!confirm("Je trainingen opnieuw over de week verdelen? Je eigen indeling en tijden vervallen.")) return;
  try {
    await api("/api/planning/standaard", { methode: "POST" });
    await laad(false);
    meld("Opnieuw verdeeld.");
  } catch (f) {
    document.getElementById("fout").textContent = foutTekst(f);
  }
});

async function laad(agendaOok = true) {
  try {
    plan = await api("/api/planning");
    tekenWeek();
    if (agendaOok) tekenAgenda(null);
  } catch (f) {
    document.getElementById("fout").textContent = foutTekst(f);
  }
}

vereisSessie().then(() => laad());
