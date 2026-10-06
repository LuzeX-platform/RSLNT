// Het beginscherm: welke training aan de beurt is, je gewicht en je laatste trainingen.

const startKnop = document.getElementById("start-knop");
const startFout = document.getElementById("start-fout");
const andereSchemas = document.getElementById("andere-schemas");
let gegevens = null;

async function start(schemaId) {
  startFout.textContent = "";
  startKnop.disabled = true;
  try {
    const { id } = await api("/api/trainingen", { methode: "POST", body: { schemaId } });
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

function faseHtml(programma) {
  const { fase } = programma;
  const delen = [];
  if (fase.fase === "intro") {
    delen.push(
      `<p><strong>Introfase · week ${fase.week} van ${programma.introWeken}.</strong> ${programma.introSets ?? ""} sets per oefening, RIR ${programma.introRir ?? "–"}: wennen voor pezen en knieën.</p>`,
    );
  } else if (fase.fase === "deload") {
    delen.push(
      `<p><strong>Deloadweek${fase.handmatig ? " (op jouw verzoek)" : ` · week ${fase.week}`}.</strong> Halve sets, zelfde gewicht.</p>`,
    );
  } else {
    const tot = programma.deloadElkeWeken ? programma.deloadElkeWeken - (fase.week % programma.deloadElkeWeken) : null;
    delen.push(`<p>Week ${fase.week} van ${escapeHtml(programma.naam)}${tot ? ` · deload over ${tot} ${tot === 1 ? "week" : "weken"}` : ""}.</p>`);
  }
  if (programma.rustAdvies) {
    delen.push(`<p class="lijst-meta">Je programma adviseert minstens ${programma.minRustdagen} rustdag tussen trainingen.</p>`);
  }
  // Handmatige deload aan of uit; een automatische deloadweek kun je niet wegtikken.
  if (fase.fase !== "deload") {
    delen.push('<button type="button" class="text-link" data-deload="aan">Ik heb een deload nodig</button>');
  } else if (fase.handmatig) {
    delen.push('<button type="button" class="text-link" data-deload="uit">Deload stoppen</button>');
  }
  return delen.join("");
}

function tekenTraining() {
  const { programma, bezig, volgendeSchema, schemas, recent } = gegevens;
  const kop = document.getElementById("kop");
  const ondertitel = document.getElementById("ondertitel");
  const faseInfo = document.getElementById("fase-info");
  andereSchemas.innerHTML = "";
  startKnop.hidden = false;
  faseInfo.hidden = !programma;
  if (programma) faseInfo.innerHTML = faseHtml(programma);

  if (bezig) {
    kop.textContent = `${bezig.schemaNaam} loopt nog`;
    ondertitel.textContent = `Training ${bezig.schemaCode}, gestart ${datumKort(bezig.datum)}.`;
    startKnop.textContent = "Verder met trainen";
    startKnop.onclick = () => (window.location.href = `/training.html?id=${bezig.id}`);
    return;
  }
  if (!volgendeSchema) {
    kop.textContent = "Nog geen programma";
    ondertitel.innerHTML = 'Laad een programma in onder <a href="/schema.html">Schema</a>.';
    startKnop.hidden = true;
    return;
  }

  kop.textContent = `${volgendeSchema.naam} is aan de beurt`;
  const laatste = recent[0];
  const duur = volgendeSchema.minuten ? `± ${volgendeSchema.minuten} min` : "";
  const vorige = laatste ? `Vorige: ${laatste.schemaNaam}, ${datumKort(laatste.datum)}.` : "Je eerste training: kies startgewichten waarmee je de range netjes haalt.";
  ondertitel.textContent = [`Training ${volgendeSchema.code}`, duur, vorige].filter(Boolean).join(" · ");
  startKnop.textContent = `Start ${volgendeSchema.naam}`;
  startKnop.onclick = () => start(volgendeSchema.id);

  for (const schema of schemas.filter((s) => s.id !== volgendeSchema.id)) {
    const knop = document.createElement("button");
    knop.type = "button";
    knop.className = "text-link set-extra";
    knop.textContent = `Liever ${schema.code} · ${schema.naam}`;
    knop.addEventListener("click", () => start(schema.id));
    andereSchemas.append(knop);
  }
}

document.getElementById("fase-info").addEventListener("click", async (e) => {
  const knop = e.target.closest("[data-deload]");
  if (!knop) return;
  const aan = knop.dataset.deload === "aan";
  if (aan && !confirm("Een week deload: halve sets, zelfde gewicht. Handig als je herstel een paar trainingen slecht is. Starten?")) return;
  try {
    await api(`/api/programmas/${gegevens.programma.id}/deload`, { methode: "POST", body: { aan } });
    gegevens = await api("/api/vandaag");
    tekenTraining();
  } catch (fout) {
    startFout.textContent = foutTekst(fout);
  }
});

function tekenGewicht() {
  const { gewicht } = gegevens;
  document.getElementById("gemiddelde").textContent = gewicht.gemiddelde7 === null ? "–" : kg(gewicht.gemiddelde7, 1);
  document.getElementById("laatste").textContent = gewicht.laatste ? kg(gewicht.laatste.gewicht, 1) : "–";
  document.getElementById("laatste-label").textContent = gewicht.laatste
    ? gewicht.laatste.datum === gewicht.vandaag
      ? "vandaag gewogen"
      : `laatste weging, ${dagKort(gewicht.laatste.datum)}`
    : "nog geen weging";
}

function tekenRecent() {
  const lijst = document.getElementById("recent");
  if (gegevens.recent.length === 0) {
    lijst.innerHTML = '<li class="lijst-meta">Nog geen trainingen.</li>';
    return;
  }
  lijst.innerHTML = gegevens.recent
    .map(
      (t) => `
      <li>
        <a class="lijst-rij" href="/training.html?id=${encodeURIComponent(t.id)}">
          <span><strong>${escapeHtml(t.schemaCode)} · ${escapeHtml(t.schemaNaam)}</strong><br /><span class="lijst-meta">${datumKort(t.datum)} · ${t.aantalSets} sets${t.fase === "deload" ? " · deload" : t.fase === "intro" ? " · intro" : ""}</span></span>
          ${t.status === "bezig" ? '<span class="badge badge-bezig">Bezig</span>' : '<span class="badge badge-succes">Klaar</span>'}
        </a>
      </li>`,
    )
    .join("");
}

document.getElementById("gewicht-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const foutEl = document.getElementById("gewicht-fout");
  const invoer = document.getElementById("gewicht-invoer");
  const waarde = leesGetal(invoer.value);
  foutEl.textContent = "";
  if (waarde === null) {
    foutEl.textContent = "Vul je gewicht in, bijvoorbeeld 81,4.";
    return;
  }
  try {
    await api(`/api/lichaamsgewicht/${gegevens.gewicht.vandaag}`, { methode: "PUT", body: { gewicht: waarde } });
    invoer.value = "";
    invoer.blur();
    gegevens = await api("/api/vandaag");
    tekenGewicht();
  } catch (fout) {
    foutEl.textContent = foutTekst(fout);
  }
});

async function laad() {
  document.getElementById("vandaag-datum").textContent = new Date().toLocaleDateString("nl-NL", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  await vereisSessie();
  try {
    gegevens = await api("/api/vandaag");
  } catch (fout) {
    document.getElementById("kop").textContent = "Kon niet laden";
    startFout.textContent = foutTekst(fout);
    return;
  }
  tekenTraining();
  tekenGewicht();
  tekenRecent();
}

laad();
