// Het portaal: wie al ingelogd is, gaat meteen naar zijn trainingen.
haalSessie().then((g) => {
  if (g && !g.offline) window.location.replace("/");
});

// Wat Pro toevoegt, uit dezelfde lijst als de Pro-pagina (common.js).
document.getElementById("pro-onderdelen").innerHTML = PRO_ONDERDELEN.map(
  (o) => `<li><strong>${escapeHtml(o.titel)}</strong><span>${escapeHtml(o.tekst)}</span></li>`,
).join("");
