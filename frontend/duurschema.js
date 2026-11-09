// Het duursportschema: kiezen (sport, niveau, doel, keer per week), een voorbeeld zien, starten.
// Daarna: deze week, je dagen en tijd, het hele schema, en stoppen. Alles meteen bewaard.

const ICOON = { hardlopen: "🏃", fietsen: "🚴", zwemmen: "🏊" };
const DAG_KORT = ["ma", "di", "wo", "do", "vr", "za", "zo"];
let data = null;
const v = { sport: "hardlopen", niveau: "beginner", doel: "conditie", afstand: null, dagenPerWeek: 3 };

function tekenKeuzes(houderId, opties, { gekozen, meervoudig = false, bijWijziging, uit = () => false }) {
  const houder = document.getElementById(houderId);
  const isGekozen = (w) => (meervoudig ? gekozen().includes(w) : gekozen() === w);
  const attr = meervoudig ? "aria-pressed" : "aria-checked";
  houder.innerHTML = opties
    .map(
      ([w, label]) =>
        `<button type="button" class="keuze" ${meervoudig ? "" : 'role="radio"'} data-waarde="${escapeHtml(String(w))}" ${attr}="${isGekozen(w)}"${uit(w) ? " disabled" : ""}>${escapeHtml(label)}</button>`,
    )
    .join("");
  houder.onclick = (e) => {
    const knop = e.target.closest("[data-waarde]");
    if (!knop || knop.disabled) return;
    bijWijziging(opties.find(([w]) => String(w) === knop.dataset.waarde)[0]);
  };
}

function sessieRegel(s) {
  const omvang = [s.meters ? `${s.meters} m` : null, `± ${s.minuten} min`].filter(Boolean).join(" · ");
  return `<strong>${escapeHtml(s.titel)}</strong> <span class="lijst-meta">${escapeHtml(omvang)}</span><br /><span class="lijst-meta">${escapeHtml(s.uitleg)}</span>`;
}

function wekenHtml(schema, huidigeWeek) {
  return schema.weken
    .map(
      (w) => `
      <details class="duur-week"${w.week === huidigeWeek ? " open" : ""}>
        <summary><strong>Week ${w.week}</strong> · ${escapeHtml(w.thema)}${w.week === huidigeWeek ? ' <span class="badge">nu</span>' : ""}</summary>
        <ul class="lijst">${w.sessies.map((s) => `<li>${sessieRegel(s)}</li>`).join("")}</ul>
      </details>`,
    )
    .join("");
}

// ---------- Kiezen ----------

function afstanden() {
  return data.keuzes.afstanden[v.sport];
}

function tekenKies() {
  const k = data.keuzes;
  tekenKeuzes("keuze-sport", Object.entries(k.sporten), {
    gekozen: () => v.sport,
    bijWijziging: (w) => {
      v.sport = w;
      v.afstand = null;
      tekenKies();
    },
  });
  tekenKeuzes("keuze-niveau", Object.entries(k.niveaus), {
    gekozen: () => v.niveau,
    bijWijziging: (w) => {
      v.niveau = w;
      if (v.afstand && !afstanden().find((a) => a.waarde === v.afstand)?.weken[w]) v.afstand = null;
      tekenKies();
    },
  });
  document.getElementById("niveau-uitleg").textContent = k.niveauUitleg[v.sport][v.niveau];
  tekenKeuzes("keuze-doel", Object.entries(k.doelen), {
    gekozen: () => v.doel,
    bijWijziging: (w) => {
      v.doel = w;
      tekenKies();
    },
  });
  const blok = document.getElementById("afstand-blok");
  blok.hidden = v.doel !== "afstand";
  if (v.doel === "afstand") {
    const lijst = afstanden();
    if (!v.afstand) v.afstand = lijst.find((a) => a.weken[v.niveau])?.waarde ?? null;
    tekenKeuzes("keuze-afstand", lijst.map((a) => [a.waarde, a.label]), {
      gekozen: () => v.afstand,
      uit: (w) => !lijst.find((a) => a.waarde === w).weken[v.niveau],
      bijWijziging: (w) => {
        v.afstand = w;
        tekenKies();
      },
    });
    const gekozen = lijst.find((a) => a.waarde === v.afstand);
    const teVer = lijst.filter((a) => !a.weken[v.niveau]).map((a) => a.label);
    document.getElementById("afstand-uitleg").textContent = [
      gekozen ? `In ${gekozen.weken[v.niveau]} weken naar ${gekozen.label}.` : "",
      teVer.length ? `${teVer.join(", ")}: eerst een kortere afstand halen.` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }
  document.getElementById("doel-uitleg").textContent = {
    conditie: "Twaalf weken opbouwen, daarna houd je het niveau vast.",
    afstand: "",
    afvallen: "Vooral rustige minuten erbij: die houd je lang vol. Het meeste verschil maakt je eten; dit helpt mee.",
  }[v.doel];
  tekenKeuzes("keuze-dagen", [2, 3, 4].map((n) => [n, `${n}×`]), {
    gekozen: () => v.dagenPerWeek,
    bijWijziging: (w) => {
      v.dagenPerWeek = w;
      tekenKies();
    },
  });
  voorbeeld();
}

let voorbeeldTeller = 0;
async function voorbeeld() {
  const paneel = document.getElementById("voorbeeld");
  const fout = document.getElementById("kies-fout");
  fout.textContent = "";
  const nr = ++voorbeeldTeller;
  try {
    const { schema, dagen } = await api("/api/duurschema/voorstel", { methode: "POST", body: { ...v, afstand: v.doel === "afstand" ? v.afstand : null } });
    if (nr !== voorbeeldTeller) return;
    v.dagen = dagen;
    paneel.hidden = false;
    paneel.innerHTML = `
      <p class="kicker">Voorbeeld</p>
      <h2>${escapeHtml(schema.titel)}</h2>
      <p class="subtitle">${escapeHtml(schema.uitleg)}</p>
      <p class="lijst-meta">Op ${dagen.map((d) => data.keuzes.weekdagen[d - 1]).join(", ")}${data.kracht.alle.length ? ", om je krachttrainingen heen" : ""}. Dat pas je daarna nog aan.</p>
      ${wekenHtml(schema, 1)}
      ${schema.opmerkingen.length ? `<ul class="opmerkingen">${schema.opmerkingen.map((o) => `<li>${escapeHtml(o)}</li>`).join("")}</ul>` : ""}`;
  } catch (f) {
    if (nr !== voorbeeldTeller) return;
    paneel.hidden = true;
    fout.textContent = foutTekst(f);
  }
}

document.getElementById("kies").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (data.schema && !confirm("Je huidige duurschema vervangen? Je begint dan bij week 1. Wat je al deed blijft bewaard.")) return;
  const knop = document.getElementById("start");
  knop.disabled = true;
  try {
    await api("/api/duurschema", { methode: "PUT", body: { ...v, afstand: v.doel === "afstand" ? v.afstand : null } });
    await laad();
    window.scrollTo({ top: 0 });
  } catch (f) {
    document.getElementById("kies-fout").textContent = foutTekst(f);
  } finally {
    knop.disabled = false;
  }
});

// ---------- Je huidige schema ----------

function tijdOpties(gekozen) {
  const tijden = [];
  for (let m = 5 * 60; m <= 23 * 60; m += 15) tijden.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
  if (!tijden.includes(gekozen)) tijden.push(gekozen);
  return tijden.sort().map((t) => `<option value="${t}"${t === gekozen ? " selected" : ""}>${t}</option>`).join("");
}

let dagen = [];
function tekenDagen() {
  const n = data.instellingen.dagenPerWeek;
  tekenKeuzes("dagen-kiezer", DAG_KORT.map((d, i) => [i + 1, d]), {
    meervoudig: true,
    gekozen: () => dagen,
    bijWijziging: (w) => {
      dagen = dagen.includes(w) ? dagen.filter((x) => x !== w) : [...dagen, w];
      tekenDagen();
      if (dagen.length === n) bewaarDagen();
    },
  });
  const nog = n - dagen.length;
  document.getElementById("dagen-uitleg").textContent =
    nog > 0
      ? `Kies nog ${nog} ${nog === 1 ? "dag" : "dagen"} (${n} in totaal).`
      : nog < 0
        ? `Te veel: haal er ${-nog} weg (${n} in totaal).`
        : `${n} dagen. De lange training komt in het weekend als dat kan, en een harde nooit op of vlak voor een benendag.`;
  const namen = (lijst) => lijst.map((d) => DAG_KORT[d - 1]).join(", ");
  const kracht = data.kracht.alle;
  document.getElementById("kracht-dagen").textContent = kracht.length
    ? `Krachttraining op ${namen(kracht)}${data.kracht.benen.length ? `; zwaar voor je benen op ${namen(data.kracht.benen)}` : ""}.`
    : "";
}

async function bewaarDagen() {
  const ok = document.getElementById("dagen-ok");
  const fout = document.getElementById("dagen-fout");
  fout.textContent = "";
  try {
    await api("/api/duurschema/dagen", { methode: "PUT", body: { dagen, tijd: document.getElementById("tijd").value } });
    await laad();
    ok.textContent = "Opgeslagen.";
    setTimeout(() => (ok.textContent = ""), 2000);
  } catch (f) {
    fout.textContent = foutTekst(f);
  }
}
document.getElementById("tijd").addEventListener("change", () => {
  if (dagen.length === data.instellingen.dagenPerWeek) bewaarDagen();
});

function tekenHuidig() {
  const { schema, instellingen, week } = data;
  document.getElementById("huidig-kicker").textContent = `${ICOON[instellingen.sport]} ${data.keuzes.sporten[instellingen.sport]} · ${
    week && week <= schema.weken.length ? `week ${week} van ${schema.weken.length}` : schema.doorlopend ? "onderhoud" : "afgerond"
  }`;
  document.getElementById("huidig-titel").textContent = schema.titel;
  document.getElementById("huidig-uitleg").textContent = schema.uitleg;
  document.getElementById("deze-week").innerHTML = data.dezeWeek.length
    ? data.dezeWeek
        .map((d) => {
          const naam = data.keuzes.weekdagen[d.weekdag - 1];
          const status = d.gedaan ? '<span class="badge badge-succes">✓ gedaan</span>' : d.datum <= data.vandaag ? `<button type="button" class="secondary" data-gedaan="${d.datum}">Gedaan</button>` : "";
          return `<li class="duur-sessie${d.datum === data.vandaag ? " vandaag" : ""}"><div><span class="lijst-meta">${naam}${d.datum === data.vandaag ? " · vandaag" : ""}</span><br />${sessieRegel(d.sessie)}</div>${status}</li>`;
        })
        .join("")
    : '<li class="lijst-meta">Je schema is klaar. Kies hieronder een nieuw doel.</li>';
  dagen = [...instellingen.dagen];
  tekenDagen();
  document.getElementById("tijd").innerHTML = tijdOpties(instellingen.tijd);
  document.getElementById("alle-weken").innerHTML = wekenHtml(schema, week);
  document.getElementById("huidig-opmerkingen").innerHTML = schema.opmerkingen.map((o) => `<li>${escapeHtml(o)}</li>`).join("");
}

document.getElementById("deze-week").addEventListener("click", async (e) => {
  const knop = e.target.closest("[data-gedaan]");
  if (!knop) return;
  knop.disabled = true;
  try {
    await api("/api/duurschema/gedaan", { methode: "POST", body: { datum: knop.dataset.gedaan } });
    await laad();
  } catch (f) {
    knop.disabled = false;
    alert(foutTekst(f));
  }
});

document.getElementById("opnieuw").addEventListener("click", () => {
  document.getElementById("huidig").hidden = true;
  document.getElementById("kies").hidden = false;
  document.getElementById("annuleer").hidden = false;
  tekenKies();
});
document.getElementById("annuleer").addEventListener("click", () => {
  document.getElementById("kies").hidden = true;
  document.getElementById("huidig").hidden = false;
});

document.getElementById("stop").addEventListener("click", async () => {
  if (!confirm("Stoppen met je duurschema? Je gelogde duurtrainingen blijven bewaard.")) return;
  try {
    await api("/api/duurschema", { methode: "DELETE" });
    await laad();
  } catch (f) {
    document.getElementById("stop-fout").textContent = foutTekst(f);
  }
});

async function laad() {
  data = await api("/api/duurschema");
  const heeft = Boolean(data.schema);
  document.getElementById("huidig").hidden = !heeft;
  document.getElementById("kies").hidden = heeft;
  document.getElementById("annuleer").hidden = true;
  if (heeft) {
    Object.assign(v, { sport: data.instellingen.sport, niveau: data.instellingen.niveau, doel: data.instellingen.doel, afstand: data.instellingen.afstand, dagenPerWeek: data.instellingen.dagenPerWeek });
    tekenHuidig();
  } else tekenKies();
}

vereisSessie()
  .then(laad)
  .catch((f) => (document.getElementById("kies-fout").textContent = foutTekst(f)));
