// Uitleg en foto's van een oefening als overlay, in plaats van naar de bibliotheekpagina te gaan.
// Midden in een training wil je de techniek even nakijken en dan meteen verder met je set; met een
// aparte pagina moest je elke keer terug en zocht je je plek opnieuw.
//
// Werkt op elke link naar /bibliotheek.html?id=… met de klasse "waarom" (training, schema,
// personaliseren): die links blijven gewone links, zodat ze zonder JavaScript of met "open in
// nieuw tabblad" gewoon werken. Een gewone <dialog> met showModal(), net als rondleiding.js: de
// browser regelt focus, Escape en dat de pagina erachter even niet te bedienen is.
//
// Geen Pro (402/403)? Dan gewoon de link volgen: de bibliotheekpagina legt uit wat Pro is.

(function () {
  let dialoog = null;

  function maakDialoog() {
    dialoog = document.createElement("dialog");
    dialoog.className = "uitleg-dialoog";
    dialoog.setAttribute("aria-labelledby", "uitleg-dialoog-naam");
    dialoog.innerHTML = `
      <div class="uitleg-dialoog-kop">
        <h2 id="uitleg-dialoog-naam"></h2>
        <button type="button" class="uitleg-dialoog-sluit" aria-label="Sluiten">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke-linecap="round"/></svg>
        </button>
      </div>
      <div class="uitleg-dialoog-inhoud"></div>`;
    dialoog.querySelector(".uitleg-dialoog-sluit").addEventListener("click", () => dialoog.close());
    // Tik naast het venster (op de gedimde achtergrond) sluit ook: dat verwacht je op een telefoon.
    dialoog.addEventListener("click", (event) => {
      if (event.target === dialoog) dialoog.close();
    });
    document.body.appendChild(dialoog);
  }

  function inhoudHtml(o) {
    const fotos = o.afbeeldingen
      .map((src, i) => `<img src="${escapeHtml(src)}" alt="${escapeHtml(o.naam)}: ${i === 0 ? "begin" : "eind"} van de beweging" loading="lazy" decoding="async" />`)
      .join("");
    const stappen = o.uitleg.length
      ? o.uitleg.map((stap) => `<li>${escapeHtml(stap)}</li>`).join("")
      : '<li class="lijst-meta">Geen uitleg in de bron.</li>';
    return `
      ${fotos ? `<div class="bieb-fotos">${fotos}</div>` : ""}
      ${o.cue ? `<p class="cue">${escapeHtml(o.cue)}</p>` : ""}
      <ol class="bieb-uitleg" lang="${o.uitlegTaal === "nl" ? "nl" : "en"}">${stappen}</ol>
      ${o.uitlegTaal === "nl" ? "" : '<p class="lijst-meta">Deze stappen zijn nog niet vertaald en staan in het Engels, zoals in de bron.</p>'}
      <p class="ruimte-boven"><a class="text-link" href="/bibliotheek.html?id=${encodeURIComponent(o.id)}">Alles over deze oefening in de bibliotheek →</a></p>`;
  }

  async function toon(id, link) {
    if (!dialoog) maakDialoog();
    const naam = dialoog.querySelector("#uitleg-dialoog-naam");
    const inhoud = dialoog.querySelector(".uitleg-dialoog-inhoud");
    naam.textContent = link.dataset.naam || "Uitleg";
    inhoud.innerHTML = '<p class="lijst-meta">Even laden…</p>';
    dialoog.showModal();
    inhoud.scrollTop = 0;
    try {
      const { oefening } = await api(`/api/bibliotheek/${encodeURIComponent(id)}`);
      naam.textContent = oefening.naam;
      inhoud.innerHTML = inhoudHtml(oefening);
    } catch (fout) {
      if (fout.status === 402 || fout.status === 403) {
        dialoog.close();
        window.location.href = link.href;
        return;
      }
      inhoud.innerHTML = `<p class="error">${escapeHtml(fout.status ? foutTekst(fout) : "Geen verbinding. De uitleg van oefeningen die je eerder opende, blijft wel beschikbaar.")}</p>`;
    }
  }

  document.addEventListener("click", (event) => {
    const link = event.target.closest('a.waarom[href^="/bibliotheek.html?id="]');
    // Cmd/Ctrl-klik of middelklik: gewoon een nieuw tabblad, zoals de gebruiker vraagt.
    if (!link || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    toon(new URL(link.href).searchParams.get("id"), link);
  });
})();
