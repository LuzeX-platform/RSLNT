// Eén script voor alle accountpagina's (zoals CMMNTY); <body data-pagina="…"> bepaalt wat er gebeurt.
const pagina = document.body.dataset.pagina;
const formulier = document.getElementById("formulier");
const foutEl = document.getElementById("fout");
const succesEl = document.getElementById("succes");

function veld(id) {
  return document.getElementById(id)?.value.trim() ?? "";
}

/** Koppelt een submit-handler met knop-blokkering en foutweergave. */
function bijVersturen(form, handler) {
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const knop = form.querySelector('button[type="submit"]');
    if (foutEl) foutEl.textContent = "";
    if (succesEl) succesEl.textContent = "";
    knop.disabled = true;
    try {
      await handler();
    } catch (fout) {
      if (foutEl) foutEl.textContent = foutTekst(fout);
      bijFout?.(fout);
    } finally {
      knop.disabled = false;
    }
  });
}
let bijFout = null;

/** Alleen interne paden als terugweg, zodat ?terug= niet naar een andere site kan sturen. */
function veiligTerug(standaard) {
  const terug = queryParam("terug");
  return terug && terug.startsWith("/") && !terug.startsWith("//") ? terug : standaard;
}

if (pagina === "inloggen") {
  haalSessie().then((g) => {
    if (g && !g.offline) window.location.href = veiligTerug("/");
  });
  const opnieuw = document.getElementById("opnieuw-sturen");
  bijFout = (fout) => {
    opnieuw.hidden = fout.data?.errorCode !== "EMAIL_NIET_BEVESTIGD";
  };
  opnieuw.addEventListener("click", async () => {
    opnieuw.disabled = true;
    try {
      await api("/api/auth/bevestiging-opnieuw", { methode: "POST", body: { email: veld("email") } });
      foutEl.textContent = "";
      succesEl.textContent = "Er staat een nieuwe bevestigingslink in je mailbox.";
      opnieuw.hidden = true;
    } catch (fout) {
      foutEl.textContent = foutTekst(fout);
    } finally {
      opnieuw.disabled = false;
    }
  });
  bijVersturen(formulier, async () => {
    opnieuw.hidden = true;
    await api("/api/auth/inloggen", {
      methode: "POST",
      body: { email: veld("email"), wachtwoord: document.getElementById("wachtwoord").value },
    });
    window.location.href = veiligTerug("/");
  });
}

if (pagina === "registreren") {
  haalSessie().then((g) => {
    if (g && !g.offline) window.location.href = "/";
  });
  bijVersturen(formulier, async () => {
    const toestemming = document.getElementById("toestemming").checked;
    if (!toestemming) {
      foutEl.textContent = "Zonder toestemming kunnen we je gegevens niet bewaren, en werkt RSLNT niet.";
      return;
    }
    await api("/api/auth/registreren", {
      methode: "POST",
      body: { naam: veld("naam"), email: veld("email"), wachtwoord: document.getElementById("wachtwoord").value, toestemming },
    });
    formulier.hidden = true;
    document.getElementById("klaar").hidden = false;
  });
}

if (pagina === "bevestigen") {
  const status = document.getElementById("status");
  const opnieuw = document.getElementById("opnieuw");
  const token = queryParam("token");
  (async () => {
    if (!token) {
      status.textContent = "Deze link is niet compleet.";
      opnieuw.hidden = false;
      return;
    }
    try {
      await api("/api/auth/bevestigen", { methode: "POST", body: { token } });
      status.textContent = "Gelukt! Je e-mailadres is bevestigd. We zetten je schema klaar…";
      setTimeout(() => (window.location.href = "/start.html"), 1200);
    } catch {
      status.textContent = "Deze link is ongeldig of al gebruikt. Al bevestigd? Log dan gewoon in.";
      opnieuw.hidden = false;
    }
  })();
  bijVersturen(opnieuw, async () => {
    await api("/api/auth/bevestiging-opnieuw", { methode: "POST", body: { email: veld("email") } });
    succesEl.textContent = "Als dit adres nog niet bevestigd is, staat er een nieuwe link in je mailbox.";
  });
}

if (pagina === "wachtwoord-vergeten") {
  bijVersturen(formulier, async () => {
    await api("/api/auth/wachtwoord-vergeten", { methode: "POST", body: { email: veld("email") } });
    succesEl.textContent = "Als dit adres bij ons bekend is, staat er een link in je mailbox. Die is een uur geldig.";
  });
}

if (pagina === "wachtwoord-resetten") {
  bijVersturen(formulier, async () => {
    await api("/api/auth/wachtwoord-resetten", {
      methode: "POST",
      body: { token: queryParam("token") ?? "", wachtwoord: document.getElementById("wachtwoord").value },
    });
    formulier.querySelector('button[type="submit"]').hidden = true;
    succesEl.innerHTML = 'Je wachtwoord is gewijzigd en je bent ingelogd. <a href="/">Naar RSLNT →</a>';
  });
}
