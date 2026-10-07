// Beheer: hoeveel mensen zich hebben aangemeld, hoeveel Pro hebben en waarvandaan. Alleen voor
// het eigenaarsaccount — de server weigert /api/admin/* met 403 voor iedereen anders (zie
// requireAdmin in plugins/requireAuth.ts), dus deze pagina is geen beveiliging op zich, puur
// het scherm erbij.

function statHtml(waarde, label) {
  return `<div class="stat"><div class="stat-waarde">${waarde}</div><div class="stat-label">${escapeHtml(label)}</div></div>`;
}

function rijHtml(g) {
  return `
    <tr>
      <td>${escapeHtml(g.naam)}</td>
      <td>${escapeHtml(g.email)}</td>
      <td>${g.emailBevestigdOp ? "Ja" : "Nee"}</td>
      <td>${g.pro ? `Ja${g.proBron ? ` <span class="lijst-meta">(${g.proBron === "accrd" ? "ACCRD" : "SCRNN"})</span>` : ""}` : "Nee"}</td>
      <td>${datumKort(g.aangemaaktOp)}</td>
    </tr>`;
}

vereisSessie().then(async (g) => {
  if (g.offline || g.rol !== "admin") return;
  try {
    const data = await api("/api/admin/overzicht");
    document.getElementById("stats").innerHTML = [
      statHtml(data.totaal, "Aangemeld"),
      statHtml(data.bevestigd, "Bevestigd"),
      statHtml(data.pro, "Pro"),
      statHtml(data.proViaAccrd + data.proViaScrnn, "Pro via ACCRD/SCRNN"),
    ].join("");
    document.getElementById("rijen").innerHTML = data.recent.map(rijHtml).join("") || '<tr><td colspan="5">Nog niemand aangemeld.</td></tr>';
  } catch {
    document.getElementById("stats").innerHTML = statHtml("—", "Kon het overzicht niet laden");
  }
});
