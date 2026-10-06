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

function tekenTraining() {
  const { bezig, volgendeSchema, schemas, recent } = gegevens;
  const kop = document.getElementById("kop");
  const ondertitel = document.getElementById("ondertitel");
  andereSchemas.innerHTML = "";
  startKnop.hidden = false;

  if (bezig) {
    kop.textContent = `${bezig.schemaNaam} loopt nog`;
    ondertitel.textContent = `Gestart ${datumKort(bezig.datum)}.`;
    startKnop.textContent = "Verder met trainen";
    startKnop.onclick = () => (window.location.href = `/training.html?id=${bezig.id}`);
    return;
  }
  if (!volgendeSchema) {
    kop.textContent = "Nog geen schema";
    startKnop.hidden = true;
    return;
  }

  kop.textContent = `${volgendeSchema.naam} is aan de beurt`;
  const laatste = recent[0];
  ondertitel.textContent = laatste
    ? `Vorige: ${laatste.schemaNaam}, ${datumKort(laatste.datum)}.`
    : "Je eerste training. Kies startgewichten waarmee je de range netjes haalt.";
  startKnop.textContent = `Start ${volgendeSchema.naam}`;
  startKnop.onclick = () => start(volgendeSchema.id);

  for (const schema of schemas.filter((s) => s.id !== volgendeSchema.id)) {
    const knop = document.createElement("button");
    knop.type = "button";
    knop.className = "text-link set-extra";
    knop.textContent = `Liever ${schema.naam}`;
    knop.addEventListener("click", () => start(schema.id));
    andereSchemas.append(knop);
  }
}

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
          <span><strong>${escapeHtml(t.schemaNaam)}</strong><br /><span class="lijst-meta">${datumKort(t.datum)} · ${t.aantalSets} sets</span></span>
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
