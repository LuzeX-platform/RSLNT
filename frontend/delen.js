// Exporteren en delen (Pro): CSV-bestanden en leeslinks voor je trainer of fysio.

const ONDERDEEL_NAMEN = { trainingen: "trainingen", kracht: "kracht en volume", pijn: "pijnlogboek", duur: "duurtraining" };

function tekenLinks(links) {
  document.getElementById("links").innerHTML = links.length
    ? links
        .map((l) => {
          const status = l.actief
            ? `geldig tot ${datumKort(l.verlooptOp)}`
            : l.ingetrokkenOp
              ? `ingetrokken ${datumKort(l.ingetrokkenOp)}`
              : `verlopen ${datumKort(l.verlooptOp)}`;
          return `
        <li class="lijst-rij">
          <span><strong>${escapeHtml(l.naam)}</strong> ${l.actief ? '<span class="badge badge-succes">Actief</span>' : '<span class="badge">Uit</span>'}<br />
          <span class="lijst-meta">${l.onderdelen.map((o) => ONDERDEEL_NAMEN[o] ?? o).join(", ")} · ${status} · ${l.laatstBekekenOp ? `laatst bekeken ${datumKort(l.laatstBekekenOp)}` : "nog niet bekeken"}</span></span>
          ${l.actief ? `<button type="button" class="text-link gevaar-link" data-intrekken="${escapeHtml(l.id)}">Intrekken</button>` : ""}
        </li>`;
        })
        .join("")
    : '<li class="lijst-meta">Nog geen links.</li>';
}

async function laad() {
  tekenLinks((await api("/api/pro/deellinks")).links);
}

document.getElementById("onderdelen").addEventListener("click", (e) => {
  const knop = e.target.closest("[data-onderdeel]");
  if (knop) knop.setAttribute("aria-pressed", String(knop.getAttribute("aria-pressed") !== "true"));
});

document.getElementById("link-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fout = document.getElementById("fout");
  fout.textContent = "";
  const onderdelen = [...document.querySelectorAll('#onderdelen [aria-pressed="true"]')].map((k) => k.dataset.onderdeel);
  try {
    const { url } = await api("/api/pro/deellinks", {
      methode: "POST",
      body: { naam: document.getElementById("naam").value.trim(), onderdelen, dagen: Number(document.getElementById("dagen").value) },
    });
    document.getElementById("nieuwe-link").hidden = false;
    document.getElementById("link-url").value = url;
    document.getElementById("gekopieerd").textContent = "";
    document.getElementById("deel").hidden = !navigator.share;
    document.getElementById("naam").value = "";
    await laad();
  } catch (f) {
    fout.textContent = foutTekst(f);
  }
});

document.getElementById("kopieer").addEventListener("click", async () => {
  const veld = document.getElementById("link-url");
  try {
    await navigator.clipboard.writeText(veld.value);
  } catch {
    veld.select();
    document.execCommand("copy");
  }
  document.getElementById("gekopieerd").textContent = "Gekopieerd.";
});

document.getElementById("deel").addEventListener("click", () => {
  navigator.share?.({ title: "Mijn training in RSLNT", url: document.getElementById("link-url").value }).catch(() => {});
});

document.getElementById("links").addEventListener("click", async (e) => {
  const knop = e.target.closest("[data-intrekken]");
  if (!knop || !confirm("Deze link intrekken? Wie hem heeft, ziet daarna niets meer.")) return;
  try {
    await api(`/api/pro/deellinks/${encodeURIComponent(knop.dataset.intrekken)}/intrekken`, { methode: "POST" });
    await laad();
  } catch (f) {
    document.getElementById("fout").textContent = foutTekst(f);
  }
});

vereisSessie().then(async (g) => {
  if (g.offline) return;
  if (!g.pro) {
    toonProSlot(
      document.getElementById("pro-slot"),
      "Exporteren en delen",
      "Werk je met een trainer of fysio? Met Pro deel je je trainingen met een link die je zelf intrekt, en exporteer je alles naar een spreadsheet.",
      ["delen", "pijn"],
    );
    return;
  }
  document.getElementById("pro-inhoud").hidden = false;
  try {
    await laad();
  } catch (f) {
    document.getElementById("fout").textContent = foutTekst(f);
  }
});
