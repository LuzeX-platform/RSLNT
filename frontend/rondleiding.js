// Rondleiding door de app: de eerste keer dat iemand op Vandaag komt, en daarna op verzoek via
// Account (/?uitleg=1). Een gewone <dialog> met showModal(): de browser regelt dan zelf de focus,
// Escape en dat de rest van de pagina even niet te bedienen is — geen eigen overlay nodig.
// Afgerond of overgeslagen telt allebei als gezien (zie /api/account/rondleiding-gezien): wie
// "Overslaan" kiest, wil hem niet bij elke keer openen terugzien.

const STAPPEN = [
  {
    titel: "Welkom bij RSLNT",
    tekst: "In een halve minuut zie je waar alles staat. Onderaan zit de balk met de vijf onderdelen van de app.",
  },
  {
    icoon: "vandaag",
    titel: "Vandaag",
    tekst: "Hier begin je elke keer. Je ziet welke training klaarstaat, doet je herstelcheck en vult je gewicht in.",
  },
  {
    icoon: "vandaag",
    titel: "Een training doen",
    tekst: "Tik op je training om te beginnen. Vul per set het gewicht en de herhalingen in. RSLNT stelt daarna voor wat je de volgende keer doet. Geen bereik in de sportschool? Je sets worden bewaard en later verstuurd.",
  },
  {
    icoon: "lichaam",
    titel: "Lichaam",
    tekst: "Je gewicht, je lichaamssamenstelling en hoeveel energie en eiwit je nodig hebt voor je doel.",
  },
  {
    icoon: "voortgang",
    titel: "Voortgang",
    tekst: "Hoe sterk je wordt, hoeveel sets je per spiergroep doet en je records.",
  },
  {
    icoon: "schema",
    titel: "Schema",
    tekst: "Je programma en je oefeningen. Hier pas je aan wat je traint, of maak je een schema op maat.",
  },
  {
    icoon: "wetenschap",
    titel: "Wetenschap",
    tekst: "Waarom RSLNT iets voorstelt: bij elke regel lees je het onderzoek erachter, en hoe zeker dat is.",
  },
  {
    titel: "Klaar",
    tekst: "Rechtsboven staat Account: je wachtwoord, je gegevens en Pro. Alles hierboven is gratis; Pro is verdieping voor wie serieuzer traint (analyse, blokken, technieken, delen met je trainer). Ook deze uitleg vind je daar terug.",
  },
];

function toonRondleiding() {
  const dialoog = document.createElement("dialog");
  dialoog.className = "rondleiding";
  dialoog.setAttribute("aria-labelledby", "rondleiding-titel");
  document.body.append(dialoog);
  let stap = 0;

  async function sluit() {
    dialoog.close();
    dialoog.remove();
    // Niet wachten op de server: als dit mislukt (geen bereik) zie je hem de volgende keer
    // gewoon nog een keer, dat is erger dan niets maar beter dan een vastgelopen knop.
    fetch("/api/account/rondleiding-gezien", { method: "POST" }).catch(() => {});
  }

  function teken() {
    const s = STAPPEN[stap];
    const laatste = stap === STAPPEN.length - 1;
    dialoog.innerHTML = `
      <div class="rondleiding-teller" aria-hidden="true">${STAPPEN.map((_, i) => `<span class="${i === stap ? "aan" : ""}"></span>`).join("")}</div>
      ${s.icoon ? `<div class="rondleiding-icoon" aria-hidden="true">${ICONEN[s.icoon]}<span>${escapeHtml(TABS.find((t) => t.icoon === s.icoon)?.label ?? "")}</span></div>` : ""}
      <h2 id="rondleiding-titel">${escapeHtml(s.titel)}</h2>
      <p>${escapeHtml(s.tekst)}</p>
      <p class="lijst-meta">Stap ${stap + 1} van ${STAPPEN.length}</p>
      <div class="rondleiding-knoppen">
        ${laatste ? "" : '<button type="button" class="rondleiding-overslaan" data-actie="overslaan">Overslaan</button>'}
        <span class="rondleiding-ruimte"></span>
        ${stap > 0 ? '<button type="button" class="secondary" data-actie="vorige">Vorige</button>' : ""}
        <button type="button" data-actie="volgende">${laatste ? "Aan de slag" : "Volgende"}</button>
      </div>`;
    dialoog.querySelector('[data-actie="volgende"]').focus();
  }

  dialoog.addEventListener("click", (e) => {
    const actie = e.target.closest("[data-actie]")?.dataset.actie;
    if (actie === "overslaan") sluit();
    if (actie === "vorige" && stap > 0) {
      stap -= 1;
      teken();
    }
    if (actie === "volgende") {
      if (stap === STAPPEN.length - 1) sluit();
      else {
        stap += 1;
        teken();
      }
    }
  });
  // Escape sluit de dialog al vanzelf; dan ook als gezien opslaan.
  dialoog.addEventListener("cancel", (e) => {
    e.preventDefault();
    sluit();
  });

  teken();
  dialoog.showModal();
}

haalSessie().then((g) => {
  if (!g || g.offline) return;
  const opVerzoek = queryParam("uitleg") === "1";
  if (opVerzoek) history.replaceState(null, "", location.pathname);
  if (opVerzoek || !g.rondleidingGezien) toonRondleiding();
});
