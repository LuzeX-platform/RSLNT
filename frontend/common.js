// Gedeeld door alle pagina's: de balk, de tabbalk, sessie, de offline-wachtrij en kleine
// hulpfuncties. Geen inline <script> in de HTML: de CSP (zie backend/src/app.ts) staat alleen
// scripts van 'self' toe — zelfde afspraak als in ACCRD en CMMNTY.

function escapeHtml(waarde) {
  const div = document.createElement("div");
  div.textContent = waarde ?? "";
  return div.innerHTML;
}

// ---------- Getallen en datums, Nederlandse notatie ----------

/** 22.5 → "22,5". Hele getallen zonder decimalen. */
function getal(waarde, decimalen = 2) {
  if (waarde === null || waarde === undefined || Number.isNaN(waarde)) return "–";
  return Number(waarde).toLocaleString("nl-NL", { maximumFractionDigits: decimalen });
}

function kg(waarde, decimalen = 2) {
  return `${getal(waarde, decimalen)} kg`;
}

/** "22,5" of "22.5" → 22.5; leeg of onzin → null. */
function leesGetal(tekst) {
  const schoon = String(tekst ?? "").trim().replace(",", ".");
  if (schoon === "") return null;
  const waarde = Number(schoon);
  return Number.isFinite(waarde) ? waarde : null;
}

function datumKort(iso) {
  return new Date(iso).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}

/** "2026-10-05" (kalenderdag) → "ma 5 okt". */
function dagKort(dag) {
  return new Date(`${dag}T12:00:00`).toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
}

function queryParam(naam) {
  return new URLSearchParams(location.search).get(naam);
}

// ---------- API ----------

/** fetch met JSON heen en terug. Gooit een Error met .status en .data bij een foutstatus;
 *  zonder verbinding een Error zonder .status. */
async function api(pad, { methode = "GET", body } = {}) {
  const response = await fetch(pad, {
    method: methode,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && !pad.startsWith("/api/auth/")) naarInloggen();
  if (!response.ok) {
    const fout = new Error(data.bericht || data.errorCode || `Fout ${response.status}`);
    fout.status = response.status;
    fout.data = data;
    throw fout;
  }
  return data;
}

const FOUTTEKSTEN = {
  ONJUISTE_INLOGGEGEVENS: "E-mailadres of wachtwoord klopt niet.",
  HUIDIG_WACHTWOORD_ONJUIST: "Je huidige wachtwoord klopt niet.",
  TE_VEEL_VERZOEKEN: "Even rustig aan — probeer het zo opnieuw.",
  NIET_INGELOGD: "Je bent niet (meer) ingelogd.",
  OEFENING_BESTAAT_AL: "Er is al een oefening met deze naam.",
  SCHEMA_LEEG: "Dit schema heeft nog geen oefeningen.",
  ONGELDIGE_DATUM: "Die datum klopt niet.",
  GEEN_ALTERNATIEF: "Die oefening staat niet bij de alternatieven.",
  AL_SETS_GELOGD: "Je hebt al sets gelogd voor deze oefening. Wis die eerst om te wisselen.",
  AL_IN_TRAINING: "Die oefening zit al in deze training.",
  ONGELDIG_PROGRAMMA: "Het programmabestand klopt niet.",
  EMAIL_NIET_BEVESTIGD: "Je e-mailadres is nog niet bevestigd. Klik op de link in de mail die we je stuurden.",
  TOKEN_ONGELDIG: "Deze link is ongeldig, verlopen of al gebruikt.",
  ADMIN_NIET_VERWIJDERBAAR: "Het eigenaarsaccount kan niet verwijderd worden.",
};

/** Maakt van een API-fout één leesbare zin, inclusief de eerste veldfout als die er is. */
function foutTekst(fout) {
  if (fout.status === undefined) return "Geen verbinding. Probeer het zo opnieuw.";
  const details = fout.data?.details;
  if (details) {
    const eerste = Object.values(details).flat()[0];
    if (eerste) return eerste;
  }
  return fout.data?.bericht || FOUTTEKSTEN[fout.data?.errorCode] || "Er ging iets mis. Probeer het opnieuw.";
}

// ---------- Sessie ----------

const OFFLINE = { offline: true };
let sessieBelofte;

/** De ingelogde gebruiker, null als je niet ingelogd bent, of OFFLINE zonder verbinding. */
function haalSessie() {
  sessieBelofte ??= fetch("/api/auth/sessie")
    .then((r) => (r.ok ? r.json() : { gebruiker: null }))
    .then((d) => d.gebruiker)
    .catch(() => OFFLINE);
  return sessieBelofte;
}

const OPENBARE_PAGINAS = ["/welkom.html", "/inloggen.html", "/registreren.html", "/bevestigen.html", "/wachtwoord-vergeten.html", "/wachtwoord-resetten.html", "/privacy.html"];

/** Niet ingelogd: het beginscherm gaat naar het portaal, een andere pagina naar inloggen met de weg terug. */
function naarInloggen() {
  if (OPENBARE_PAGINAS.includes(location.pathname)) return;
  if (location.pathname === "/" || location.pathname === "/index.html") {
    window.location.href = "/welkom.html";
    return;
  }
  window.location.href = `/inloggen.html?terug=${encodeURIComponent(location.pathname + location.search)}`;
}

/** Voor pagina's achter de login. Zonder verbinding laten we je erin: in de sportschool met
 *  slecht bereik moet je kunnen blijven loggen, de server controleert straks toch. */
async function vereisSessie() {
  const gebruiker = await haalSessie();
  if (!gebruiker) {
    naarInloggen();
    return new Promise(() => {}); // pagina blijft staan tot de redirect er is
  }
  return gebruiker;
}

/**
 * Uitloggen ruimt ook op wat op deze telefoon staat: de offline-kopieën van je pagina's en gegevens
 * en de wachtrij. Zo ziet iemand anders die hier inlogt niets van jou.
 */
async function uitloggen() {
  const wachtend = leesWachtrij().length;
  if (wachtend && !confirm(`Er ${wachtend === 1 ? "staat nog 1 set" : `staan nog ${wachtend} sets`} klaar om te versturen. Uitloggen gooit ${wachtend === 1 ? "die" : "ze"} weg. Toch uitloggen?`)) {
    return;
  }
  await fetch("/api/auth/uitloggen", { method: "POST" }).catch(() => {});
  try {
    localStorage.removeItem(WACHTRIJ_SLEUTEL);
  } catch {
    // geen opslag beschikbaar: niets op te ruimen
  }
  if ("caches" in window) {
    try {
      for (const naam of await caches.keys()) await caches.delete(naam);
    } catch {
      // cache niet bereikbaar: de service worker ververst bij de volgende keer online
    }
  }
  window.location.href = "/welkom.html";
}

// ---------- Offline-wachtrij ----------
// Alles wat je tijdens een training opslaat gaat via deze wachtrij. Valt de verbinding weg,
// dan blijft het in localStorage staan en gaat het vanzelf door zodra er weer bereik is.
// Elk item heeft een sleutel (bijv. de plek van een set): een nieuwere versie vervangt een
// oudere die nog niet verstuurd was, zodat er nooit iets ouds overheen geschreven wordt.

const WACHTRIJ_SLEUTEL = "rslnt-wachtrij";
const OPNIEUW_NA_MS = 10000;

function leesWachtrij() {
  try {
    return JSON.parse(localStorage.getItem(WACHTRIJ_SLEUTEL)) || [];
  } catch {
    return [];
  }
}

function schrijfWachtrij(lijst) {
  try {
    localStorage.setItem(WACHTRIJ_SLEUTEL, JSON.stringify(lijst));
  } catch {
    // Privémodus of vol: dan werkt alleen direct versturen. Niets aan te doen.
  }
}

function meldWachtrij() {
  const aantal = leesWachtrij().length;
  window.dispatchEvent(new CustomEvent("wachtrij", { detail: { aantal } }));
  const el = document.getElementById("wachtrij-indicator");
  if (el) {
    el.hidden = aantal === 0;
    el.textContent = `${aantal} wacht op verbinding`;
  }
}

/** Zet een schrijfactie in de wachtrij en probeert meteen te versturen. */
function verstuurViaWachtrij({ sleutel, pad, methode, body }) {
  const lijst = leesWachtrij().filter((item) => item.sleutel !== sleutel);
  lijst.push({ sleutel, pad, methode, body, versie: `${Date.now()}-${Math.random()}` });
  schrijfWachtrij(lijst);
  meldWachtrij();
  return verwerkWachtrij();
}

let wachtrijBezig = null;
let opnieuwTimer = null;

function verwerkWachtrij() {
  // Vrijgeven via .finally(): dat loopt altijd ná het toewijzen, ook als er niets te doen is.
  wachtrijBezig ??= verwerk().finally(() => {
    wachtrijBezig = null;
    meldWachtrij();
  });
  return wachtrijBezig;
}

async function verwerk() {
  for (;;) {
    const item = leesWachtrij()[0];
    if (!item) break;
    try {
      await api(item.pad, { methode: item.methode, body: item.body });
    } catch (fout) {
      const tijdelijk = fout.status === undefined || fout.status >= 500 || fout.status === 429;
      if (tijdelijk || fout.status === 401) {
        clearTimeout(opnieuwTimer);
        opnieuwTimer = setTimeout(verwerkWachtrij, OPNIEUW_NA_MS);
        break;
      }
      // 400/404: dit gaat nooit lukken. Weggooien, anders blokkeert het de rest.
      window.dispatchEvent(new CustomEvent("wachtrij-fout", { detail: { item, bericht: foutTekst(fout) } }));
    }
    // Alleen deze versie weghalen: is er intussen een nieuwere, dan gaat die als volgende.
    schrijfWachtrij(leesWachtrij().filter((i) => i.versie !== item.versie));
    meldWachtrij();
  }
}

window.addEventListener("online", verwerkWachtrij);

// ---------- Balk en tabbalk ----------

const ICONEN = {
  vandaag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/></svg>',
  lichaam: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="4.5" r="2.2"/><path d="M5 8.5h14M12 8.5v6M12 14.5 8.5 21M12 14.5l3.5 6.5"/></svg>',
  voortgang: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 20h18"/><path d="M4 16l5-5 4 3 7-8"/><path d="M15 6h5v5"/></svg>',
  schema: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6h.01M4 12h.01M4 18h.01"/></svg>',
  wetenschap: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M9 8h7M9 12h5"/></svg>',
};

const TABS = [
  { href: "/", label: "Vandaag", icoon: "vandaag", match: (p) => p === "/" || p === "/index.html" || p.startsWith("/training") },
  { href: "/lichaam.html", label: "Lichaam", icoon: "lichaam", match: (p) => p.startsWith("/lichaam") || p.startsWith("/gewicht") },
  { href: "/voortgang.html", label: "Voortgang", icoon: "voortgang", match: (p) => p.startsWith("/voortgang") },
  { href: "/schema.html", label: "Schema", icoon: "schema", match: (p) => p.startsWith("/schema") || p.startsWith("/bibliotheek") || p.startsWith("/personaliseren") },
  { href: "/wetenschap.html", label: "Wetenschap", icoon: "wetenschap", match: (p) => p.startsWith("/wetenschap") },
];

function tekenBalk() {
  const houder = document.getElementById("balk");
  if (!houder) return;
  const ingelogd = document.body.classList.contains("app");
  houder.className = "balkhouder";
  houder.innerHTML = `
    <div class="balk">
      <a href="/" class="merk" aria-label="LuzeX RSLNT — naar vandaag">
        <span class="brand-logo" role="img" aria-label="LuzeX"></span>
        <span class="merk-product">RSLNT</span>
      </a>
      <div class="balk-acties">
        <span class="wachtrij-indicator" id="wachtrij-indicator" role="status" hidden></span>
        ${
          ingelogd
            ? '<a class="text-link" href="/account.html">Account</a>'
            : location.pathname === "/inloggen.html"
              ? '<a class="text-link" href="/registreren.html">Account maken</a>'
              : '<a class="text-link" href="/inloggen.html">Inloggen</a>'
        }
      </div>
    </div>`;
}

function tekenTabbalk() {
  if (!document.body.classList.contains("app")) return;
  const nav = document.createElement("nav");
  nav.className = "tabbalk";
  nav.setAttribute("aria-label", "Hoofdnavigatie");
  nav.innerHTML = TABS.map((tab) => {
    const actief = tab.match(location.pathname);
    return `<a href="${tab.href}"${actief ? ' class="actief" aria-current="page"' : ""}>${ICONEN[tab.icoon]}<span>${tab.label}</span></a>`;
  }).join("");
  document.body.append(nav);
}

tekenBalk();
tekenTabbalk();
meldWachtrij();
verwerkWachtrij();

// De service worker houdt de pagina's beschikbaar als het bereik wegvalt (zie /sw.js).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
