// Het personalisatiemenu: voorkeuren invullen, een schemavoorstel laten maken (de server rekent,
// zie backend/src/generator.ts) en dat bekijken, downloaden of inladen als programma "Op maat".

const MINUTEN = [30, 45, 60, 75, 90, 120];
/** Via de start voor nieuwe accounts (start.html): na het activeren meteen naar Vandaag. */
const START = queryParam("start") === "1";
const DAGEN = [2, 3, 4, 5, 6];
const MAX_FOCUS = 3;

let keuzes = null;
let v = null; // voorkeuren zoals in het formulier
let voorstel = null;

const datumLang = (dag) =>
  new Date(`${dag}T12:00:00`).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
const kgTempo = (w) => `${w > 0 ? "+" : ""}${getal(w, 2)} kg`;

// ---------- Keuzeknoppen ----------

/** Tekent knoppen met aria-pressed. Enkelvoudig (radio) of meervoudig. */
function tekenKeuzes(houderId, opties, { gekozen, meervoudig = false, bijWijziging }) {
  const houder = document.getElementById(houderId);
  const isGekozen = (w) => (meervoudig ? gekozen().includes(w) : gekozen() === w);
  houder.innerHTML = opties
    .map(
      ([waarde, label]) =>
        `<button type="button" class="keuze" ${meervoudig ? "" : 'role="radio"'} data-waarde="${escapeHtml(String(waarde))}" aria-${meervoudig ? "pressed" : "checked"}="${isGekozen(waarde)}">${escapeHtml(label)}</button>`,
    )
    .join("");
  houder.onclick = (e) => {
    const knop = e.target.closest("[data-waarde]");
    if (!knop) return;
    const waarde = opties.find(([w]) => String(w) === knop.dataset.waarde)[0];
    bijWijziging(waarde);
    for (const k of houder.querySelectorAll("[data-waarde]")) {
      const w = opties.find(([x]) => String(x) === k.dataset.waarde)[0];
      k.setAttribute(meervoudig ? "aria-pressed" : "aria-checked", String(isGekozen(w)));
    }
  };
}

function wissel(lijst, waarde) {
  return lijst.includes(waarde) ? lijst.filter((x) => x !== waarde) : [...lijst, waarde];
}

function tekenFormulier() {
  tekenKeuzes("keuze-doel", Object.entries(keuzes.doelen), { gekozen: () => v.doel, bijWijziging: (w) => (v.doel = w) });
  tekenKeuzes("keuze-ervaring", Object.entries(keuzes.ervaring), { gekozen: () => v.ervaring, bijWijziging: (w) => (v.ervaring = w) });
  tekenKeuzes("keuze-dagen", DAGEN.map((d) => [d, `${d}×`]), { gekozen: () => v.dagenPerWeek, bijWijziging: (w) => (v.dagenPerWeek = w) });
  tekenKeuzes("keuze-minuten", MINUTEN.map((m) => [m, String(m)]), { gekozen: () => v.minutenPerTraining, bijWijziging: (w) => (v.minutenPerTraining = w) });
  tekenKeuzes("keuze-materiaal", Object.entries(keuzes.materiaal), {
    gekozen: () => v.materiaal,
    meervoudig: true,
    bijWijziging: (w) => (v.materiaal = wissel(v.materiaal, w)),
  });
  tekenKeuzes("keuze-blessures", Object.entries(keuzes.blessures), {
    gekozen: () => v.blessures,
    meervoudig: true,
    bijWijziging: (w) => (v.blessures = wissel(v.blessures, w)),
  });
  tekenKeuzes("keuze-focus", Object.entries(keuzes.spieren), {
    gekozen: () => v.focus,
    meervoudig: true,
    bijWijziging: (w) => {
      const fout = document.getElementById("focus-fout");
      fout.textContent = "";
      if (!v.focus.includes(w) && v.focus.length >= MAX_FOCUS) {
        fout.textContent = `Hoogstens ${MAX_FOCUS}: met alles extra is niets extra.`;
        return;
      }
      v.focus = wissel(v.focus, w);
    },
  });
}

function tekenMijnOefeningen(favorieten, uitgesloten) {
  const rij = (label, lijst) =>
    `<li class="lijst-rij"><span><span class="lijst-meta">${label}</span><br />${
      lijst.length ? lijst.map((o) => `<a href="/bibliotheek.html?id=${encodeURIComponent(o.id)}">${escapeHtml(o.naam)}</a>`).join(", ") : "Nog niets gemarkeerd."
    }</span></li>`;
  document.getElementById("mijn-oefeningen").innerHTML = rij("★ Favorieten", favorieten) + rij("Niet voor mij", uitgesloten);
}

// ---------- Doelgewicht ----------

function tekenHaalbaarheid(lichaam) {
  const el = document.getElementById("haalbaarheid");
  const h = lichaam.haalbaarheid;
  if (lichaam.kg === null) {
    el.textContent = "Weeg je eerst (op Vandaag of Lichaam), dan rekenen we uit of je datum haalbaar is.";
    return;
  }
  if (!h) {
    el.textContent = lichaam.doelgewicht
      ? "Vul een datum in, dan zie je of die haalbaar is in een verstandig tempo."
      : "Vul een doelgewicht en een datum in, dan zie je of dat haalbaar is.";
    return;
  }
  const advies = `${kgTempo(h.nodigPerWeek < 0 ? -h.aanbevolen.min : h.aanbevolen.min)} tot ${kgTempo(h.nodigPerWeek < 0 ? -h.aanbevolen.max : h.aanbevolen.max)} per week`;
  const venster = h.vroegst && h.uiterlijk ? `tussen ${datumLang(h.vroegst)} en ${datumLang(h.uiterlijk)}` : "";
  const teksten = {
    te_snel: ["badge-bezig", "Te snel", `Daarvoor moet je ${kgTempo(h.nodigPerWeek)} per week, het advies is ${advies}. Realistisch: ${venster}.`],
    haalbaar: ["badge-succes", "Haalbaar", `${kgTempo(h.nodigPerWeek)} per week, binnen het advies van ${advies}.`],
    ruim: ["badge-succes", "Ruim op tijd", `${kgTempo(h.nodigPerWeek)} per week is rustiger dan nodig. In het aanbevolen tempo haal je het ${venster}.`],
    verlopen: ["badge-bezig", "Datum voorbij", `Kies een datum in de toekomst. In het aanbevolen tempo: ${venster}.`],
    bereikt: ["badge-succes", "Bereikt", "Je zit al op je doelgewicht."],
  };
  const [klasse, kop, tekst] = teksten[h.oordeel];
  el.innerHTML = `<span class="badge ${klasse}">${kop}</span> ${escapeHtml(tekst)} <a class="waarom" href="/wetenschap.html#aankomen">Waarom?</a>`;
}

function leesDoel() {
  const tekst = document.getElementById("doelgewicht").value.trim();
  return {
    doelgewicht: leesGetal(tekst),
    onleesbaar: tekst !== "" && leesGetal(tekst) === null,
    streefdatum: document.getElementById("streefdatum").value || null,
  };
}

// ---------- Voorstel ----------

function regelHtml(r) {
  const rust = r.rust >= 120 && r.rust % 60 === 0 ? `${r.rust / 60} min` : `${r.rust} s`;
  return `
    <li class="lijst-rij voorstel-regel">
      <span><strong>${escapeHtml(r.naam)}</strong>${r.knieGevoelig ? ' <span class="badge badge-knie">Knie</span>' : ""}<br />
      <span class="lijst-meta">${r.sets} × ${r.repMin}–${r.repMax}${r.perKant ? " per kant" : ""} · RIR ${r.rir} · rust ${rust}</span>
      ${r.cue ? `<br /><span class="lijst-meta voorstel-cue">${escapeHtml(r.cue)}</span>` : ""}</span>
      ${r.bibliotheekId ? `<a class="waarom" href="/bibliotheek.html?id=${encodeURIComponent(r.bibliotheekId)}">Uitleg</a>` : ""}
    </li>`;
}

function tekenVoorstel() {
  document.getElementById("voorstel").hidden = false;
  document.getElementById("split-naam").textContent = voorstel.split.naam;
  const minuten = voorstel.sessies.map((s) => s.minuten);
  document.getElementById("split-uitleg").textContent =
    `${voorstel.split.uitleg} Ongeveer ${Math.min(...minuten) === Math.max(...minuten) ? minuten[0] : `${Math.min(...minuten)}–${Math.max(...minuten)}`} minuten per training.`;
  document.getElementById("opmerkingen").innerHTML = voorstel.opmerkingen.map((t) => `<li class="melding">${escapeHtml(t)}</li>`).join("");

  document.getElementById("sessies").innerHTML = voorstel.sessies
    .map(
      (s) => `
      <section class="panel">
        <div class="panel-kop">
          <h2>${escapeHtml(s.code)} · ${escapeHtml(s.naam)}</h2>
          <span class="lijst-meta">~${s.minuten} min</span>
        </div>
        <ul class="lijst">${s.regels.map(regelHtml).join("")}</ul>
      </section>`,
    )
    .join("");

  tekenVolume();
  tekenInladenUitleg();
}

/** Los van de rest: bij een andere schermbreedte tekenen we alleen de grafiek opnieuw. */
function tekenVolume() {
  const rijen = voorstel.volume.filter((r) => r.doel !== null);
  staafGrafiek(
    document.getElementById("volume-grafiek"),
    rijen.map((r) => ({
      label: r.label,
      waarde: r.sets,
      doel: r.doel,
      tooltip: [
        { waarde: `${getal(r.sets, 1)} sets`, label: "per week" },
        { waarde: `${r.doel} sets`, label: "weekdoel" },
      ],
    })),
    { formatWaarde: (w) => getal(w, 1), label: "Sets per spiergroep per week in dit voorstel, met het weekdoel" },
  );
  document.getElementById("volume-tabel").innerHTML = tabelHtml(
    ["Spiergroep", "Sets per week", "Weekdoel"],
    voorstel.volume.map((r) => [r.label, getal(r.sets, 1), r.doel ?? "–"]),
  );
}

function tekenInladenUitleg() {
  document.getElementById("inladen-uitleg").textContent = voorstel.bestaatAl
    ? `Je hebt al een programma "Op maat"${voorstel.bestaatAl.actief ? " (actief)" : ""}; dat wordt bijgewerkt. ${
        voorstel.bestaatAl.actief ? "Je blijft in dezelfde week." : "Activeer je het, dan begint het bij week 1 met twee weken introfase."
      } Oefeningen die je al deed houden hun geschiedenis.`
    : 'Het schema wordt een programma "Op maat". Activeer je het, dan begint het bij week 1 met twee weken introfase. Oefeningen die je al deed houden hun geschiedenis; je huidige programma blijft bewaard onder Schema.';
  document.getElementById("inladen-fout").textContent = "";
  document.getElementById("inladen-succes").textContent = "";
}

async function maakVoorstel(e) {
  e.preventDefault();
  const fout = document.getElementById("form-fout");
  const knop = document.getElementById("maak");
  fout.textContent = "";
  const { doelgewicht, onleesbaar, streefdatum } = leesDoel();
  if (onleesbaar) {
    fout.textContent = "Doelgewicht: vul een getal in, bijvoorbeeld 90.";
    return;
  }
  knop.disabled = true;
  try {
    const opgeslagen = await api("/api/voorkeuren", {
      methode: "PUT",
      body: {
        doel: v.doel,
        ervaring: v.ervaring,
        dagenPerWeek: v.dagenPerWeek,
        minutenPerTraining: v.minutenPerTraining,
        materiaal: v.materiaal,
        blessures: v.blessures,
        focus: v.focus,
        doelgewicht,
        streefdatum,
      },
    });
    tekenHaalbaarheid(opgeslagen.lichaam);
    voorstel = await api("/api/voorstel", { methode: "POST" });
    tekenVoorstel();
    document.getElementById("voorstel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (f) {
    fout.textContent = foutTekst(f);
  } finally {
    knop.disabled = false;
  }
}

async function laadIn(activeren) {
  if (!voorstel) return;
  if (activeren && !START && !confirm("Dit schema activeren? Je volgende training komt dan uit dit schema.")) return;
  const fout = document.getElementById("inladen-fout");
  const succes = document.getElementById("inladen-succes");
  fout.textContent = "";
  succes.textContent = "";
  try {
    const res = await api("/api/programmas/import", { methode: "POST", body: { bestand: voorstel.bestand, activeren } });
    if (activeren && START) {
      window.location.href = "/";
      return;
    }
    succes.innerHTML = activeren
      ? 'Ingeladen en actief. <a href="/">Naar Vandaag →</a>'
      : 'Ingeladen. Je vindt het onder <a href="/schema.html">Schema</a>, waar je het ook activeert.';
    if (res.waarschuwingen?.length) succes.innerHTML += `<br /><span class="lijst-meta">${res.waarschuwingen.map(escapeHtml).join(" ")}</span>`;
    voorstel.bestaatAl = { id: res.id, actief: activeren || Boolean(voorstel.bestaatAl?.actief) };
  } catch (f) {
    fout.textContent = foutTekst(f);
  }
}

function download() {
  if (!voorstel) return;
  const blob = new Blob([JSON.stringify(voorstel.bestand, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `rslnt-op-maat-${voorstel.bestand.program.created}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function laad() {
  if (START) {
    document.querySelector(".app-kop .kicker").textContent = "Stap 2 van 2";
    document.querySelector(".app-kop h1").textContent = "Je schema";
    document.getElementById("activeren").textContent = "Dit schema gebruiken";
    document.getElementById("inladen").hidden = true;
  }
  try {
    const data = await api("/api/voorkeuren");
    keuzes = data.keuzes;
    v = { ...data.voorkeuren };
    tekenFormulier();
    tekenMijnOefeningen(data.favorieten, data.uitgesloten);
    if (data.lichaam.doelgewicht !== null) document.getElementById("doelgewicht").value = getal(data.lichaam.doelgewicht, 1);
    if (data.lichaam.streefdatum) document.getElementById("streefdatum").value = data.lichaam.streefdatum;
    tekenHaalbaarheid(data.lichaam);
  } catch (f) {
    document.getElementById("form-fout").textContent = foutTekst(f);
  }
}

document.getElementById("voorkeuren-form").addEventListener("submit", maakVoorstel);
document.getElementById("activeren").addEventListener("click", () => laadIn(true));
document.getElementById("inladen").addEventListener("click", () => laadIn(false));
document.getElementById("download").addEventListener("click", download);
bijBreedteWijziging(() => voorstel && tekenVolume());

vereisSessie().then(laad);
