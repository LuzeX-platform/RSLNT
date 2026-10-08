import nodemailer, { type Transporter } from "nodemailer";

// Zelfde aanpak als ACCRD en CMMNTY: gewone SMTP via nodemailer. Mailgun én SendGrid bieden allebei
// SMTP aan, dus overstappen is alleen een kwestie van andere SMTP_*-waarden, geen code.
//   Mailgun:  SMTP_HOST=smtp.eu.mailgun.org  SMTP_USER=postmaster@mg.luzex.nl
//   SendGrid: SMTP_HOST=smtp.sendgrid.net    SMTP_USER=apikey
// Zonder SMTP_HOST (lokaal) wordt niets verstuurd maar de mail gelogd, zodat links uit
// bevestigings- en resetmails altijd te testen zijn.
let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!process.env.SMTP_HOST) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_WACHTWOORD } : undefined,
    });
  }
  return transporter;
}

function afzender(): string {
  return process.env.SMTP_AFZENDER ?? "LuzeX RSLNT <rslnt@mail.luzex.nl>";
}

/**
 * Het publieke adres van de app, voor links in mails. APP_URL als die er is (bijv. het eigen domein),
 * anders het adres dat Render zelf meegeeft (RENDER_EXTERNAL_URL). Nooit localhost in productie:
 * een link naar localhost opent op de telefoon van een ander niets.
 */
export function appUrl(): string {
  const basis = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT ?? 4200}`;
  return basis.trim().replace(/\/+$/, "");
}

/** Waarschuwingen bij het starten: zonder deze instellingen kan niemand zijn account bevestigen. */
export function mailWaarschuwingen(): string[] {
  if (process.env.NODE_ENV !== "production") return [];
  const meldingen: string[] = [];
  if (!process.env.SMTP_HOST) {
    meldingen.push("SMTP_HOST ontbreekt: bevestigings- en resetmails worden NIET verstuurd. De links staan in deze log ([mailer]).");
  }
  if (!process.env.APP_URL) {
    meldingen.push(`APP_URL ontbreekt: links in mails gebruiken ${appUrl()}. Zet APP_URL op je eigen domein (bijv. https://rslnt.luzex.nl).`);
  }
  return meldingen;
}

interface Mail {
  naar: string;
  onderwerp: string;
  tekst: string;
}

/** Laatst "verstuurde" mail zonder SMTP: alleen voor tests (links uit de mail volgen). */
export const testPostvak: Mail[] = [];

export async function verstuurMail(mail: Mail): Promise<void> {
  const client = getTransporter();
  if (!client) {
    testPostvak.push(mail);
    if (testPostvak.length > 50) testPostvak.shift();
    if (process.env.NODE_ENV !== "test") {
      console.warn(`[mailer] Geen SMTP_HOST — mail aan ${mail.naar} niet verstuurd, alleen gelogd.\nOnderwerp: ${mail.onderwerp}\n${mail.tekst}`);
    }
    return;
  }
  await client.sendMail({ from: afzender(), to: mail.naar, subject: mail.onderwerp, text: mail.tekst });
}

export async function verstuurBevestigingsmail(naar: string, naam: string, link: string): Promise<void> {
  await verstuurMail({
    naar,
    onderwerp: "Bevestig je e-mailadres — LuzeX RSLNT",
    tekst:
      `Hoi ${naam},\n\nWelkom bij LuzeX RSLNT. Bevestig je e-mailadres via deze link:\n${link}\n\n` +
      "Heb je geen account aangemaakt? Dan kun je deze e-mail negeren; het account wordt na 7 dagen vanzelf verwijderd.",
  });
}

export async function verstuurWachtwoordResetMail(naar: string, link: string): Promise<void> {
  await verstuurMail({
    naar,
    onderwerp: "Wachtwoord opnieuw instellen — LuzeX RSLNT",
    tekst:
      `Je hebt een nieuw wachtwoord aangevraagd voor LuzeX RSLNT.\n\nStel het in via deze link (1 uur geldig):\n${link}\n\n` +
      "Heb je dit niet zelf aangevraagd? Dan kun je deze e-mail negeren.",
  });
}
