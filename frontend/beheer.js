// Beheer: hoeveel mensen zich hebben aangemeld, hoeveel Pro hebben en waarvandaan. Alleen voor
// het eigenaarsaccount — de server weigert /api/admin/* met 403 voor iedereen anders (zie
// requireAdmin in plugins/requireAuth.ts), dus deze pagina is geen beveiliging op zich, puur
// het scherm erbij.

function statHtml(waarde, label) {
  return `<div class="stat"><div class="stat-waarde">${waarde}</div><div class="stat-label">${escapeHtml(label)}</div></div>`;
}

// "scrnn" komt alleen nog voor bij oude accounts (SCRNN is gearchiveerd); die tonen we als oud.
const BRONNEN = { accrd: "via ACCRD", scrnn: "via SCRNN (oud)", handmatig: "cadeau" };

// Alleen een cadeau kun je hier ook weer intrekken; betaald Pro of Pro via ACCRD niet (de server
// weigert dat ook, zie routes/admin.ts).
function actieHtml(g) {
  if (!g.pro) return `<button type="button" class="knop-link" data-pro-geven="${escapeHtml(g.id)}">Pro geven</button>`;
  if (g.proBron === "handmatig") return `<button type="button" class="knop-link" data-pro-intrekken="${escapeHtml(g.id)}">Pro intrekken</button>`;
  return "";
}

function rijHtml(g) {
  const bron = g.proBron ? BRONNEN[g.proBron] ?? g.proBron : "betaald";
  return `
    <tr>
      <td>${escapeHtml(g.naam)}</td>
      <td>${escapeHtml(g.email)}</td>
      <td>${g.emailBevestigdOp ? "Ja" : `Nee <button type="button" class="knop-link" data-bevestigen="${escapeHtml(g.id)}">Bevestigen</button>`}</td>
      <td>${g.pro ? `Ja <span class="lijst-meta">(${escapeHtml(bron)})</span>` : "Nee"}</td>
      <td>${datumKort(g.aangemaaktOp)}</td>
      <td>${actieHtml(g)}</td>
    </tr>`;
}

async function laadOverzicht() {
  try {
    const data = await api("/api/admin/overzicht");
    document.getElementById("stats").innerHTML = [
      statHtml(data.totaal, "Aangemeld"),
      statHtml(data.bevestigd, "Bevestigd"),
      statHtml(data.pro, "Pro"),
      statHtml(data.proCadeau, "Pro cadeau"),
    ].join("");
    document.getElementById("rijen").innerHTML = data.recent.map(rijHtml).join("") || '<tr><td colspan="6">Nog niemand aangemeld.</td></tr>';
    document.getElementById("uitnodigingen-blok").hidden = data.uitnodigingen.length === 0;
    document.getElementById("uitnodigingen").innerHTML = data.uitnodigingen
      .map(
        (u) => `<tr>
          <td>${escapeHtml(u.email)}</td>
          <td>${datumKort(u.aangemaaktOp)}</td>
          <td><button type="button" class="knop-link" data-uitnodiging-intrekken="${escapeHtml(u.id)}">Intrekken</button></td>
        </tr>`,
      )
      .join("");
  } catch {
    document.getElementById("stats").innerHTML = statHtml("—", "Kon het overzicht niet laden");
  }
}

document.getElementById("rijen").addEventListener("click", async (event) => {
  const geven = event.target.dataset.proGeven;
  const intrekken = event.target.dataset.proIntrekken;
  const bevestigen = event.target.dataset.bevestigen;
  if (!geven && !intrekken && !bevestigen) return;
  const fout = document.getElementById("beheer-fout");
  fout.textContent = "";
  event.target.disabled = true;
  try {
    if (bevestigen) await api(`/api/admin/gebruikers/${encodeURIComponent(bevestigen)}/bevestigen`, { methode: "POST" });
    else await api(`/api/admin/gebruikers/${encodeURIComponent(geven || intrekken)}/pro`, { methode: "PATCH", body: { pro: Boolean(geven) } });
    await laadOverzicht();
  } catch (f) {
    fout.textContent = foutTekst(f);
    event.target.disabled = false;
  }
});

document.getElementById("cadeau-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const fout = document.getElementById("cadeau-fout");
  const succes = document.getElementById("cadeau-succes");
  const veld = document.getElementById("cadeau-email");
  fout.textContent = "";
  succes.textContent = "";
  try {
    const { status } = await api("/api/admin/pro-uitnodigingen", { methode: "POST", body: { email: veld.value.trim() } });
    succes.textContent =
      status === "toegekend"
        ? `${veld.value.trim()} heeft nu Pro.`
        : `Klaargezet: ${veld.value.trim()} krijgt Pro zodra dit adres een account heeft en bevestigd is.`;
    veld.value = "";
    await laadOverzicht();
  } catch (f) {
    fout.textContent = foutTekst(f);
  }
});

document.getElementById("uitnodigingen").addEventListener("click", async (event) => {
  const id = event.target.dataset.uitnodigingIntrekken;
  if (!id) return;
  event.target.disabled = true;
  try {
    await api(`/api/admin/pro-uitnodigingen/${encodeURIComponent(id)}/intrekken`, { methode: "POST" });
    await laadOverzicht();
  } catch (f) {
    document.getElementById("cadeau-fout").textContent = foutTekst(f);
    event.target.disabled = false;
  }
});

async function laadMail() {
  try {
    const m = await api("/api/admin/mail");
    document.getElementById("mail-status").innerHTML = m.ingesteld
      ? `<li>✓ Mailserver: ${escapeHtml(m.server)}</li><li>✓ Afzender: ${escapeHtml(m.afzender)}</li>`
      : "<li>✗ Geen mailserver ingesteld. Er gaat nu géén mail de deur uit: zet de SMTP-waarden in Render.</li>";
  } catch {
    document.getElementById("mail-status").innerHTML = "<li>Kon de mailstatus niet laden.</li>";
  }
}

document.getElementById("testmail-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const fout = document.getElementById("mail-fout");
  const succes = document.getElementById("mail-succes");
  const knop = event.target.querySelector("button");
  const adres = document.getElementById("testmail-naar").value.trim();
  fout.textContent = "";
  succes.textContent = "";
  knop.disabled = true;
  try {
    const { naar } = await api("/api/admin/mail/test", { methode: "POST", body: adres ? { naar: adres } : {} });
    succes.textContent = `Verstuurd naar ${naar}.`;
  } catch (f) {
    fout.textContent = foutTekst(f);
  } finally {
    knop.disabled = false;
  }
});

vereisSessie().then((g) => {
  if (g.offline || g.rol !== "admin") return;
  laadOverzicht();
  laadMail();
});
