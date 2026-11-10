// Wetenschap als rustige inhoudsopgave: elk onderwerp is één regel (onderwerp en de regel in een
// zin) en klapt open met de uitleg en de bronnen. Een link naar #onderwerp opent dat onderwerp.
// De HTML blijft gewone secties: de "Waarom?"-vensters in de app lezen die rechtstreeks.

function klapIn() {
  for (const sectie of document.querySelectorAll("section.bron-kaart")) {
    const details = document.createElement("details");
    details.className = `${sectie.className} uitklap onderwerp`;
    details.id = sectie.id;
    const kicker = sectie.querySelector(":scope > .kicker");
    const titel = sectie.querySelector(":scope > h2");
    const summary = document.createElement("summary");
    summary.innerHTML = `<span class="onderwerp-kop"><span class="onderwerp-label">${kicker?.innerHTML ?? ""}</span><span class="onderwerp-titel">${titel?.textContent ?? ""}</span></span>`;
    kicker?.remove();
    titel?.remove();
    details.append(summary, ...sectie.childNodes);
    sectie.replaceWith(details);
  }
  document.querySelector("nav.inhoud")?.setAttribute("hidden", "");
}

function openVanuitAdres() {
  const id = decodeURIComponent(location.hash.slice(1));
  const doel = id && document.getElementById(id);
  if (doel?.tagName === "DETAILS") {
    doel.open = true;
    doel.scrollIntoView({ block: "start" });
  }
}

klapIn();
openVanuitAdres();
window.addEventListener("hashchange", openVanuitAdres);
