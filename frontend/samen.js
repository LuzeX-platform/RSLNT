// Samen trainen: uitnodigen (code en link), meedoen, starten, en zien hoe ver de anderen zijn.
// Geen gewichten van elkaar: alleen je voornaam, je oefening en hoeveel sets klaar zijn.

let code = (queryParam("code") ?? "").toUpperCase().replace(/[\s-]/g, "");
let sessie = null;
let ververs = null;

const linkVan = (c) => `${location.origin}/samen.html?code=${c}`;
const STATUS = { wacht: "nog niet begonnen", bezig: "bezig", klaar: "klaar ✓" };

function deelnemerHtml(d) {
  const wie = `${escapeHtml(d.naam)}${d.ikzelf ? " (jij)" : ""}${d.gastheer ? ' <span class="badge">nodigde uit</span>' : ""}`;
  const balk = d.setsTotaal ? `<div class="samen-balk" aria-hidden="true"><span style="width:${Math.round((100 * d.setsGedaan) / d.setsTotaal)}%"></span></div>` : "";
  const detail = d.status === "bezig" ? `${d.nu ? `${escapeHtml(d.nu)} · ` : ""}${d.setsGedaan} van ${d.setsTotaal} sets` : STATUS[d.status];
  return `<li class="samen-wie${d.status === "klaar" ? " klaar" : ""}"><div><strong>${wie}</strong><br /><span class="lijst-meta">${detail}</span></div>${balk}</li>`;
}

function teken() {
  const s = sessie;
  document.getElementById("begin").hidden = true;
  document.getElementById("sessie").hidden = false;
  document.getElementById("kop").textContent = s.naam;
  document.getElementById("ondertitel").textContent = s.ikGastheer
    ? "Jouw uitnodiging. Iedereen traint met de eigen gewichten."
    : `${s.gastheer} nodigt je uit om samen te trainen. Je doet deze oefeningen met je eigen gewichten en voorstellen.`;

  document.getElementById("deel").hidden = !s.ikGastheer || !s.geldig;
  document.getElementById("code").textContent = s.code;
  const tot = new Date(s.geldigTot).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  document.getElementById("geldig").textContent = `Meedoen kan tot ${tot}. ${s.aantal} van 6 plekken bezet.`;

  const actie = document.getElementById("actie");
  if (!s.geldig && !s.mijnTrainingId) {
    actie.innerHTML = "<p><strong>Deze uitnodiging is verlopen.</strong> Vraag om een nieuwe code.</p>";
  } else if (s.mijnTrainingId) {
    actie.innerHTML = `<a class="knop-link knop-groot" href="/training.html?id=${encodeURIComponent(s.mijnTrainingId)}">Naar je training</a>`;
  } else if (s.doetMee) {
    actie.innerHTML = `<p class="subtitle">${s.ikGastheer ? "Begin zodra jullie er klaar voor zijn." : "Je doet mee. Begin als jullie zover zijn."}</p><button type="button" class="knop-groot" id="start">Start de training</button>`;
  } else if (s.vol) {
    actie.innerHTML = "<p><strong>Er doen al 6 mensen mee.</strong> Vraag of er een nieuwe uitnodiging kan.</p>";
  } else {
    actie.innerHTML = `<p class="subtitle">Train mee met ${escapeHtml(s.gastheer)}: ${s.oefeningen.length} oefeningen${s.minuten ? `, ± ${s.minuten} min` : ""}.</p><button type="button" class="knop-groot" id="doe-mee">Doe mee</button>`;
  }

  document.getElementById("wie").hidden = !s.doetMee;
  document.getElementById("deelnemers").innerHTML = s.deelnemers.map(deelnemerHtml).join("");
  document.getElementById("oefeningen-kop").textContent = `De oefeningen (${s.oefeningen.length})`;
  document.getElementById("oefeningen").innerHTML = s.oefeningen.map((o) => `<li>${escapeHtml(o.naam)} <span class="lijst-meta">${o.sets} × ${escapeHtml(o.reps)}</span></li>`).join("");

  const stoppen = document.getElementById("stoppen");
  stoppen.hidden = !s.doetMee;
  stoppen.textContent = s.ikGastheer ? "Uitnodiging stoppen" : "Toch niet meedoen";
}

async function laadSessie() {
  try {
    sessie = await api(`/api/samen/${encodeURIComponent(code)}`);
    teken();
  } catch (f) {
    clearInterval(ververs);
    document.getElementById("sessie").hidden = true;
    await toonBegin();
    document.getElementById("code-invoer").value = code;
    document.getElementById("code-fout").textContent = foutTekst(f);
  }
}

async function toonBegin() {
  document.getElementById("begin").hidden = false;
  const select = document.getElementById("schema");
  try {
    const v = await api("/api/vandaag");
    if (!v.programma || !v.schemas.length) {
      select.closest("section").innerHTML = '<h2>Nodig iemand uit</h2><p class="subtitle">Maak eerst een schema; dan kun je een van je trainingen kiezen. <a class="text-link" href="/start.html">Maak een schema</a></p>';
      return;
    }
    select.innerHTML = v.schemas
      .map((s) => `<option value="${s.id}"${s.id === v.volgendeSchema?.id ? " selected" : ""}>${escapeHtml(s.naam)}${s.id === v.volgendeSchema?.id ? " (aan de beurt)" : ""}</option>`)
      .join("");
  } catch (f) {
    document.getElementById("uitnodigen-fout").textContent = foutTekst(f);
  }
}

function naarCode(nieuw) {
  code = nieuw;
  history.replaceState(null, "", `/samen.html?code=${code}`);
  laadSessie();
  clearInterval(ververs);
  // Elke 5 seconden de stand van de anderen, alleen als de pagina in beeld is.
  ververs = setInterval(() => {
    if (document.visibilityState === "visible") laadSessie();
  }, 5000);
}

document.getElementById("uitnodigen").addEventListener("click", async (e) => {
  e.target.disabled = true;
  try {
    const { code: nieuw } = await api("/api/samen", { methode: "POST", body: { schemaId: document.getElementById("schema").value } });
    naarCode(nieuw);
  } catch (f) {
    document.getElementById("uitnodigen-fout").textContent = foutTekst(f);
  } finally {
    e.target.disabled = false;
  }
});

document.getElementById("code-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const c = document.getElementById("code-invoer").value.toUpperCase().replace(/[\s-]/g, "");
  document.getElementById("code-fout").textContent = "";
  if (!/^[A-Z0-9]{6}$/.test(c)) {
    document.getElementById("code-fout").textContent = "Een code heeft 6 tekens.";
    return;
  }
  naarCode(c);
});

document.getElementById("actie").addEventListener("click", async (e) => {
  const knop = e.target.closest("button");
  if (!knop) return;
  const fout = document.getElementById("actie-fout");
  fout.textContent = "";
  knop.disabled = true;
  try {
    if (knop.id === "doe-mee") {
      await api(`/api/samen/${code}/doe-mee`, { methode: "POST" });
      await laadSessie();
    } else if (knop.id === "start") {
      const { id } = await api(`/api/samen/${code}/start`, { methode: "POST" });
      window.location.href = `/training.html?id=${encodeURIComponent(id)}`;
    }
  } catch (f) {
    if (f.status === 409 && f.data?.id) {
      fout.innerHTML = `${escapeHtml(f.data.bericht ?? "Je hebt nog een training open.")} <a class="text-link" href="/training.html?id=${encodeURIComponent(f.data.id)}">Naar die training</a>`;
    } else fout.textContent = foutTekst(f);
    knop.disabled = false;
  }
});

document.getElementById("delen").addEventListener("click", async () => {
  const tekst = `Train je mee? ${sessie.naam} in RSLNT. Code: ${sessie.code}`;
  if (navigator.share) {
    try {
      await navigator.share({ title: "Samen trainen", text: tekst, url: linkVan(sessie.code) });
      return;
    } catch {
      return; // geannuleerd
    }
  }
  kopieer();
});

async function kopieer() {
  try {
    await navigator.clipboard.writeText(linkVan(sessie.code));
    document.getElementById("geldig").textContent = "Link gekopieerd. Plak hem in WhatsApp of een berichtje.";
  } catch {
    prompt("Kopieer deze link:", linkVan(sessie.code));
  }
}
document.getElementById("kopieer").addEventListener("click", kopieer);

document.getElementById("stoppen").addEventListener("click", async () => {
  const vraag = sessie.ikGastheer
    ? "De uitnodiging stoppen? Niemand kan dan nog meedoen. Wat al gelogd is, blijft bij iedereen staan."
    : "Toch niet meedoen? Wat je al logde blijft staan.";
  if (!confirm(vraag)) return;
  try {
    await api(`/api/samen/${code}`, { methode: "DELETE" });
    window.location.href = "/samen.html";
  } catch (f) {
    document.getElementById("actie-fout").textContent = foutTekst(f);
  }
});

vereisSessie().then(() => (code ? naarCode(code) : toonBegin()));
