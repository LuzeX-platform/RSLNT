// Grafieken als inline SVG, zonder bibliotheek (zelfde keuze als het dashboard in ACCRD).
// Afspraken uit de dataviz-richtlijnen: lijnen 2px, punten ≥ 8px met een ring in de
// vlakkleur, banden als lichte waas, haarlijnen voor het raster (nooit gestippeld), één
// y-as, en een hover-laag met kruisdraad en tooltip. Teksten via textContent, nooit via HTML.
// Kleuren komen uit CSS-tokens (--grafiek-*), met eigen waarden voor donkere modus.

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(naam, attributen = {}) {
  const el = document.createElementNS(SVG_NS, naam);
  for (const [k, v] of Object.entries(attributen)) el.setAttribute(k, v);
  return el;
}

/** Ronde getallen voor een as: 80, 82, 84 … */
function mooieTicks(min, max, aantal = 4) {
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const ruw = (max - min) / aantal;
  const macht = 10 ** Math.floor(Math.log10(ruw));
  const stap = [1, 2, 2.5, 5, 10].map((f) => f * macht).find((s) => s >= ruw);
  const start = Math.floor(min / stap) * stap;
  const eind = Math.ceil(max / stap) * stap;
  const ticks = [];
  for (let v = start; v <= eind + stap / 1000; v += stap) ticks.push(Math.round(v * 1000) / 1000);
  return { ticks, min: start, max: eind };
}

const DAG_MS = 86400000;
const dagNaarMs = (dag) => Date.parse(`${dag}T12:00:00Z`);
const kortDatum = (ms) => new Date(ms).toLocaleDateString("nl-NL", { day: "numeric", month: "short", timeZone: "UTC" });

/** Eén tooltip per grafiek, als HTML boven de SVG. */
function maakTooltip(houder) {
  let tip = houder.querySelector(".grafiek-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "grafiek-tip";
    tip.hidden = true;
    houder.append(tip);
  }
  return {
    toon(x, y, regels) {
      tip.replaceChildren(
        ...regels.map(({ waarde, label, sleutel }) => {
          const rij = document.createElement("div");
          rij.className = "grafiek-tip-rij";
          if (sleutel) {
            const k = document.createElement("span");
            k.className = `grafiek-sleutel grafiek-sleutel-${sleutel}`;
            rij.append(k);
          }
          const w = document.createElement("strong");
          w.textContent = waarde;
          const l = document.createElement("span");
          l.textContent = label;
          rij.append(w, l);
          return rij;
        }),
      );
      tip.hidden = false;
      const breedte = houder.clientWidth;
      const tipBreedte = tip.offsetWidth;
      tip.style.left = `${Math.min(Math.max(x - tipBreedte / 2, 0), breedte - tipBreedte)}px`;
      tip.style.top = `${Math.max(y - tip.offsetHeight - 10, 0)}px`;
    },
    verberg() {
      tip.hidden = true;
    },
  };
}

/**
 * Tijdgrafiek: punten, een lijn en optioneel een band, op één y-as.
 * @param {HTMLElement} houder
 * @param {object} o
 *   o.punten  [{ dag, y }]        losse metingen (punten)
 *   o.lijn    [{ dag, y }]        de lijn (bijv. 7-daags gemiddelde)
 *   o.band    [{ dag, laag, hoog }] doelband (waas)
 *   o.formatY (y) => string
 *   o.tooltip (dag) => [{ waarde, label, sleutel }]
 *   o.label   toegankelijke beschrijving
 */
function tijdGrafiek(houder, o) {
  const breedte = Math.max(houder.clientWidth, 280);
  const hoogte = 220;
  const m = { links: 44, rechts: 14, boven: 12, onder: 28 };
  const alle = [...(o.punten ?? []), ...(o.lijn ?? [])];
  const dagen = [...new Set([...alle.map((p) => p.dag), ...(o.band ?? []).map((b) => b.dag)])].sort();
  if (dagen.length === 0) {
    houder.replaceChildren(Object.assign(document.createElement("p"), { className: "lijst-meta", textContent: "Nog geen gegevens." }));
    return;
  }
  const xMin = dagNaarMs(dagen[0]);
  const xMax = Math.max(dagNaarMs(dagen[dagen.length - 1]), xMin + DAG_MS);
  const yWaarden = [...alle.map((p) => p.y), ...(o.band ?? []).flatMap((b) => [b.laag, b.hoog])];
  const y = mooieTicks(Math.min(...yWaarden), Math.max(...yWaarden));
  const sx = (dag) => m.links + ((dagNaarMs(dag) - xMin) / (xMax - xMin)) * (breedte - m.links - m.rechts);
  const sy = (w) => m.boven + (1 - (w - y.min) / (y.max - y.min)) * (hoogte - m.boven - m.onder);

  const svg = svgEl("svg", { viewBox: `0 0 ${breedte} ${hoogte}`, width: breedte, height: hoogte, role: "img", tabindex: "0", "aria-label": o.label });
  const raster = svgEl("g", { class: "grafiek-raster" });
  for (const t of y.ticks) {
    raster.append(svgEl("line", { x1: m.links, x2: breedte - m.rechts, y1: sy(t), y2: sy(t) }));
    const tekst = svgEl("text", { x: m.links - 6, y: sy(t) + 4, "text-anchor": "end", class: "grafiek-as" });
    tekst.textContent = o.formatY(t);
    raster.append(tekst);
  }
  const xTicks = Math.min(4, dagen.length);
  for (let i = 0; i < xTicks; i++) {
    const ms = xMin + ((xMax - xMin) * i) / Math.max(xTicks - 1, 1);
    const tekst = svgEl("text", {
      x: m.links + ((ms - xMin) / (xMax - xMin)) * (breedte - m.links - m.rechts),
      y: hoogte - 8,
      "text-anchor": i === 0 ? "start" : i === xTicks - 1 ? "end" : "middle",
      class: "grafiek-as",
    });
    tekst.textContent = kortDatum(ms);
    raster.append(tekst);
  }
  svg.append(raster);

  if (o.band?.length) {
    const boven = o.band.map((b) => `${sx(b.dag)},${sy(b.hoog)}`);
    const onder = [...o.band].reverse().map((b) => `${sx(b.dag)},${sy(b.laag)}`);
    svg.append(svgEl("polygon", { points: [...boven, ...onder].join(" "), class: "grafiek-band" }));
  }
  if (o.lijn?.length > 1) {
    const d = o.lijn.map((p, i) => `${i ? "L" : "M"}${sx(p.dag).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
    svg.append(svgEl("path", { d, class: "grafiek-lijn" }));
  }
  for (const p of o.punten ?? []) svg.append(svgEl("circle", { cx: sx(p.dag), cy: sy(p.y), r: 4, class: "grafiek-punt" }));
  // Eindpunt van de lijn als stip, zodat het nu-punt opvalt.
  const laatste = o.lijn?.[o.lijn.length - 1];
  if (laatste) svg.append(svgEl("circle", { cx: sx(laatste.dag), cy: sy(laatste.y), r: 4.5, class: "grafiek-eindpunt" }));

  // Hover: kruisdraad die naar de dichtstbijzijnde dag springt.
  const draad = svgEl("line", { y1: m.boven, y2: hoogte - m.onder, class: "grafiek-draad", visibility: "hidden" });
  svg.append(draad);
  houder.replaceChildren(svg);
  houder.classList.add("grafiek");
  const tip = maakTooltip(houder);
  const posities = dagen.map((dag) => ({ dag, x: sx(dag) }));
  let index = -1;

  function toon(i) {
    index = Math.max(0, Math.min(posities.length - 1, i));
    const { dag, x } = posities[index];
    draad.setAttribute("x1", x);
    draad.setAttribute("x2", x);
    draad.setAttribute("visibility", "visible");
    tip.toon((x / breedte) * houder.clientWidth, m.boven + 8, [{ waarde: kortDatum(dagNaarMs(dag)), label: "" }, ...o.tooltip(dag)]);
  }
  function verberg() {
    draad.setAttribute("visibility", "hidden");
    tip.verberg();
  }
  svg.addEventListener("pointermove", (e) => {
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * breedte;
    let beste = 0;
    posities.forEach((p, i) => {
      if (Math.abs(p.x - x) < Math.abs(posities[beste].x - x)) beste = i;
    });
    toon(beste);
  });
  svg.addEventListener("pointerleave", verberg);
  svg.addEventListener("blur", verberg);
  svg.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      toon(index < 0 ? posities.length - 1 : index + (e.key === "ArrowRight" ? 1 : -1));
    }
  });
}

/**
 * Liggende staven met een referentielijn (bijv. 10 sets per week).
 *   rijen [{ label, waarde, tooltip: [{ waarde, label }] }]
 *   o.referentie, o.referentieLabel, o.formatWaarde, o.label
 */
function staafGrafiek(houder, rijen, o) {
  const breedte = Math.max(houder.clientWidth, 280);
  const rijHoogte = 30;
  const dikte = 14;
  const m = { links: 132, rechts: 36, boven: 22, onder: 6 };
  const hoogte = m.boven + rijen.length * rijHoogte + m.onder;
  const max = Math.max(o.referentie ?? 0, ...rijen.map((r) => r.waarde), 1) * 1.1;
  const sx = (w) => m.links + (w / max) * (breedte - m.links - m.rechts);

  const svg = svgEl("svg", { viewBox: `0 0 ${breedte} ${hoogte}`, width: breedte, height: hoogte, role: "img", "aria-label": o.label });
  if (o.referentie) {
    const x = sx(o.referentie);
    svg.append(svgEl("line", { x1: x, x2: x, y1: m.boven - 4, y2: hoogte - m.onder, class: "grafiek-referentie" }));
    const t = svgEl("text", { x, y: m.boven - 8, "text-anchor": "middle", class: "grafiek-as" });
    t.textContent = o.referentieLabel;
    svg.append(t);
  }
  houder.replaceChildren(svg);
  houder.classList.add("grafiek");
  const tip = maakTooltip(houder);

  rijen.forEach((r, i) => {
    const yMidden = m.boven + i * rijHoogte + rijHoogte / 2;
    const label = svgEl("text", { x: m.links - 8, y: yMidden + 4, "text-anchor": "end", class: "grafiek-label" });
    label.textContent = r.label;
    svg.append(label);
    const eind = sx(r.waarde);
    if (r.waarde > 0) {
      // Afgerond aan het data-einde (4px), recht aan de basislijn.
      const x0 = m.links;
      const y0 = yMidden - dikte / 2;
      const straal = Math.min(4, eind - x0);
      const d = `M${x0},${y0} H${eind - straal} Q${eind},${y0} ${eind},${y0 + straal} V${y0 + dikte - straal} Q${eind},${y0 + dikte} ${eind - straal},${y0 + dikte} H${x0} Z`;
      svg.append(svgEl("path", { d, class: "grafiek-staaf" }));
    }
    const waarde = svgEl("text", { x: eind + 6, y: yMidden + 4, class: "grafiek-waarde" });
    waarde.textContent = o.formatWaarde(r.waarde);
    svg.append(waarde);
    // Raakvlak: de hele rij, groter dan de staaf zelf.
    const vlak = svgEl("rect", { x: 0, y: yMidden - rijHoogte / 2, width: breedte, height: rijHoogte, class: "grafiek-raakvlak", tabindex: "0" });
    const toon = () => tip.toon((Math.min(eind, breedte - 40) / breedte) * houder.clientWidth, yMidden - 6, [{ waarde: r.label, label: "" }, ...r.tooltip]);
    vlak.addEventListener("pointerenter", toon);
    vlak.addEventListener("focus", toon);
    vlak.addEventListener("pointerleave", () => tip.verberg());
    vlak.addEventListener("blur", () => tip.verberg());
    svg.append(vlak);
  });
}

/** Tekent opnieuw bij een andere breedte (draaien van de telefoon). */
function bijBreedteWijziging(teken) {
  let vorige = window.innerWidth;
  let timer;
  window.addEventListener("resize", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (window.innerWidth !== vorige) {
        vorige = window.innerWidth;
        teken();
      }
    }, 150);
  });
}

/** Tabelweergave onder een grafiek: elke waarde is ook zonder hover te lezen. */
function tabelHtml(koppen, rijen) {
  const kop = koppen.map((k) => `<th>${escapeHtml(k)}</th>`).join("");
  const body = rijen.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(String(c))}</td>`).join("")}</tr>`).join("");
  return `<details class="grafiek-tabel"><summary>Als tabel</summary><div class="tabel-scroll"><table class="tabel"><thead><tr>${kop}</tr></thead><tbody>${body}</tbody></table></div></details>`;
}
