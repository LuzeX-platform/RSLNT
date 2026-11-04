// Een leeslink (Pro): wat iemand met je trainer of fysio deelt. Het token staat in het #-deel
// van de URL; dat stuurt de browser nooit mee, dus we sturen het zelf in de body (zie
// backend/src/routes/gedeeld.ts). Alleen lezen, geen account nodig.

const SOORT = { drop: "dropset", myo: "myo-reps", restpauze: "rest-pause" };
const FASE = { intro: "introfase", deload: "deload", licht: "lichte dag" };

function setTekst(s) {
  const delen = [s.gewicht === null ? `${s.reps} reps` : `${getal(s.gewicht)} kg × ${s.reps}`];
  if (s.rir !== null) delen.push(`RIR ${s.rir}`);
  if (s.pijn !== null) delen.push(`pijn ${s.pijn}${s.pijnPlek ? ` (${(PIJN_PLEKKEN[s.pijnPlek] ?? s.pijnPlek).toLowerCase()})` : ""}`);
  if (s.soort && s.soort !== "normaal") delen.push(SOORT[s.soort] ?? s.soort);
  return delen.join(" · ");
}

function trainingenHtml(trainingen) {
  if (!trainingen.length) return '<section class="panel"><h2>Trainingen</h2><p class="subtitle">Nog geen afgeronde trainingen.</p></section>';
  return `<section class="panel"><h2>Trainingen</h2><p class="subtitle">De laatste ${trainingen.length} afgeronde trainingen.</p>
    ${trainingen
      .map(
        (t) => `
      <details class="export-uitleg">
        <summary>${datumKort(t.datum)} · ${escapeHtml(t.schemaCode)} ${escapeHtml(t.schemaNaam)}${FASE[t.fase] ? ` · ${FASE[t.fase]}` : ""}</summary>
        ${t.oefeningen
          .map(
            (o) => `<p><strong>${escapeHtml(o.naam)}</strong> <span class="lijst-meta">(${o.repsMin}–${o.repsMax} reps)</span><br />
            <span class="lijst-meta">${o.sets.map((s) => escapeHtml(setTekst(s))).join("<br />")}</span></p>`,
          )
          .join("")}
      </details>`,
      )
      .join("")}</section>`;
}

function krachtHtml(kracht) {
  const rijen = kracht.oefeningen.map((o) => [
    o.naam,
    `${getal(o.e1rm, 1)} kg`,
    o.trend ? `${o.trend.kgPerWeek >= 0 ? "+" : ""}${getal(o.trend.kgPerWeek, 2)} kg/week` : "–",
    o.records.map((r) => `${r.reps}×${getal(r.gewicht)}`).join(", ") || "–",
  ]);
  const volume = kracht.volume.rijen.map((r) => [r.label, getal(r.gemiddeld, 1), ...r.weken.slice(-4).map((w) => getal(w, 1))]);
  const kop = (t) => `<th>${escapeHtml(t)}</th>`;
  const tabel = (koppen, data) =>
    `<div class="tabel-scroll"><table class="tabel weken-tabel"><thead><tr>${koppen.map(kop).join("")}</tr></thead><tbody>${data
      .map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join("")}</tr>`)
      .join("")}</tbody></table></div>`;
  return `
    <section class="panel"><h2>Kracht</h2>
      <p class="subtitle">Geschatte 1RM (beste van de laatste drie trainingen), het tempo over 8 weken en de zwaarste set per aantal reps.</p>
      ${rijen.length ? tabel(["Oefening", "1RM", "Tempo", "Records (reps×kg)"], rijen) : '<p class="lijst-meta">Nog geen sets met gewicht.</p>'}
    </section>
    <section class="panel"><h2>Volume per spiergroep</h2>
      <p class="subtitle">Fractionele sets per week (hulpspieren tellen half), gemiddeld en de laatste 4 weken.</p>
      ${volume.length ? tabel(["Spiergroep", "Gem.", "3 wk geleden", "2 wk geleden", "Vorige week", "Deze week"], volume) : '<p class="lijst-meta">Nog geen sets.</p>'}
    </section>`;
}

function pijnHtml(pijn) {
  const plekken = pijn.plekken
    .map(
      (p) => `<li class="lijst-rij"><span><strong>${escapeHtml(p.label)}</strong><br /><span class="lijst-meta">laatst ${dagKort(p.laatst)} · per week: ${p.perWeek
        .map((w) => (w === null ? "–" : w))
        .join(" ")}${p.oefeningen.length ? ` · ${p.oefeningen.map((o) => `${escapeHtml(o.naam)} (max ${o.max})`).join(", ")}` : ""}</span></span></li>`,
    )
    .join("");
  const notities = pijn.notities
    .map(
      (n) => `<li class="lijst-rij"><span><strong>${escapeHtml(n.plekLabel)} · ${n.ernst}/10${n.status === "hersteld" ? " · hersteld" : ""}</strong><br /><span class="lijst-meta">${dagKort(n.datum)}${n.notitie ? ` · ${escapeHtml(n.notitie)}` : ""}</span></span></li>`,
    )
    .join("");
  return `<section class="panel"><h2>Pijnlogboek</h2><p class="subtitle">De laatste ${pijn.weken} weken: hoogste pijn per week (0–10) per plek.</p>
    <ul class="lijst">${plekken || '<li class="lijst-meta">Geen pijn ingevuld.</li>'}</ul>
    ${notities ? `<h3 class="ruimte-boven">Notities</h3><ul class="lijst">${notities}</ul>` : ""}</section>`;
}

function duurHtml(duur) {
  return `<section class="panel"><h2>Duurtraining</h2><p class="subtitle">De laatste 90 dagen.</p><ul class="lijst">${
    duur.lijst
      .map(
        (d) => `<li class="lijst-rij"><span><strong>${escapeHtml(duur.soorten[d.soort] ?? d.soort)} · ${d.minuten} min${d.afstandMeter !== null ? ` · ${getal(d.afstandMeter / 1000, 2)} km` : ""}</strong><br /><span class="lijst-meta">${dagKort(d.datum)} · ${escapeHtml((duur.intensiteiten[d.intensiteit] ?? d.intensiteit).split(" (")[0])}</span></span></li>`,
      )
      .join("") || '<li class="lijst-meta">Geen duurtrainingen.</li>'
  }</ul></section>`;
}

async function laad() {
  const token = location.hash.slice(1);
  const kop = document.getElementById("kop");
  if (!token) {
    kop.textContent = "Geen link";
    document.getElementById("fout").textContent = "Deze pagina werkt alleen met een leeslink uit RSLNT.";
    return;
  }
  try {
    const d = await api("/api/gedeeld", { methode: "POST", body: { token } });
    kop.textContent = `De training van ${d.van}`;
    document.getElementById("ondertitel").textContent = `Gedeeld met ${d.voor} · geldig tot ${datumKort(d.verlooptOp)}`;
    document.title = `De training van ${d.van} — LuzeX RSLNT`;
    document.getElementById("inhoud").innerHTML = [
      d.trainingen && trainingenHtml(d.trainingen),
      d.kracht && krachtHtml(d.kracht),
      d.pijn && pijnHtml(d.pijn),
      d.duur && duurHtml(d.duur),
    ]
      .filter(Boolean)
      .join("");
    document.getElementById("afdrukken").hidden = false;
  } catch (f) {
    kop.textContent = "Link werkt niet";
    document.getElementById("fout").textContent = foutTekst(f);
  }
}

document.getElementById("afdrukken").addEventListener("click", () => window.print());
window.addEventListener("hashchange", laad);
laad();
