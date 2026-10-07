import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { hashToken, hashWachtwoord, maakEenmaligToken, maakSessieToken, verifieerWachtwoord } from "../auth.js";
import { appUrl, verstuurBevestigingsmail, verstuurWachtwoordResetMail } from "../mailer.js";
import { geldigeSessie, gid, requireIngelogd, wisSessieCookie, zetSessieCookie } from "../plugins/requireAuth.js";
import { controleerKruisproductPro } from "../luzexEntitlement.js";

// Accounts zoals CMMNTY: registreren met een bevestigingsmail, inloggen met vergrendeling na vijf
// missers, wachtwoord vergeten via een resetmail. Antwoorden verraden nooit of een e-mailadres
// al een account heeft.

// Strenge limiet waar een aanvaller iets te winnen heeft. Ruim genoeg voor een mens die zich
// vertypt, te krap voor een script.
export const AUTH_LIMIET = { rateLimit: { max: 10, timeWindow: "15 minutes" } };
const MAX_POGINGEN = 5;
const VERGRENDELING_MS = 15 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
/** Niet bevestigde accounts ruimen we na een week op: dan was het waarschijnlijk niet jouw adres. */
const ONBEVESTIGD_BEWAREN_MS = 7 * 24 * 60 * 60 * 1000;

/** Versie van de privacyverklaring waarvoor iemand toestemming gaf (frontend/privacy.html). */
export const PRIVACY_VERSIE = "2026-10-07";

const email = z.string().trim().toLowerCase().email("Ongeldig e-mailadres").max(200);
const nieuwWachtwoord = z.string().min(10, "Wachtwoord moet minimaal 10 tekens zijn").max(200);

const registreerSchema = z.object({
  naam: z.string().trim().min(1, "Vul je naam in").max(60),
  email,
  wachtwoord: nieuwWachtwoord,
  toestemming: z.literal(true, { errorMap: () => ({ message: "Geef toestemming om je gezondheidsgegevens te bewaren" }) }),
});

const inlogSchema = z.object({ email, wachtwoord: z.string().min(1) });

const wachtwoordSchema = z.object({ huidig: z.string().min(1), nieuw: nieuwWachtwoord });

export function ongeldig(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ errorCode: "ONGELDIGE_INVOER", details: error.flatten().fieldErrors });
}

function logIn(reply: FastifyReply, g: { id: string; email: string; sessieVersie: number }) {
  zetSessieCookie(reply, maakSessieToken({ gebruikerId: g.id, email: g.email, versie: g.sessieVersie }));
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/registreren", { config: AUTH_LIMIET }, async (request, reply) => {
    const parsed = registreerSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const { naam, email, wachtwoord } = parsed.data;

    await prisma.gebruiker.deleteMany({
      where: { emailBevestigdOp: null, aangemaaktOp: { lt: new Date(Date.now() - ONBEVESTIGD_BEWAREN_MS) } },
    });

    const { ruweToken, tokenHash } = maakEenmaligToken();
    const link = `${appUrl()}/bevestigen.html?token=${ruweToken}`;
    const bestaand = await prisma.gebruiker.findUnique({ where: { email } });
    if (bestaand) {
      // Zelfde antwoord als bij een nieuw adres, zodat niet af te tasten is wie er een account heeft.
      // Nog niet bevestigd? Dan sturen we de bevestigingsmail gewoon opnieuw.
      if (!bestaand.emailBevestigdOp) {
        await prisma.gebruiker.update({ where: { id: bestaand.id }, data: { bevestigTokenHash: tokenHash } });
        await verstuurBevestigingsmail(email, bestaand.naam, link);
      }
      return { ok: true };
    }
    await prisma.gebruiker.create({
      data: {
        naam,
        email,
        wachtwoordHash: await hashWachtwoord(wachtwoord),
        bevestigTokenHash: tokenHash,
        toestemmingOp: new Date(),
        privacyVersie: PRIVACY_VERSIE,
      },
    });
    await verstuurBevestigingsmail(email, naam, link);
    return { ok: true };
  });

  app.post("/api/auth/bevestigen", { config: AUTH_LIMIET }, async (request, reply) => {
    const parsed = z.object({ token: z.string().min(1).max(200) }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const gebruiker = await prisma.gebruiker.findUnique({ where: { bevestigTokenHash: hashToken(parsed.data.token) } });
    if (!gebruiker) return reply.code(400).send({ errorCode: "TOKEN_ONGELDIG" });
    // Kruisproduct-Pro: een actief ACCRD- of SCRNN-account met hetzelfde e-mailadres geeft
    // gratis Pro, zie luzexEntitlement.ts. Pas hier gecontroleerd (niet al bij registreren):
    // dit is het moment waarop het adres bevestigd is, dus ook het moment waarop we zeker
    // weten dat het van deze persoon is. Alleen bij een nog niet-Pro account: nooit een
    // bestaand (betaald) Pro-abonnement overschrijven.
    const bron = gebruiker.pro ? null : await controleerKruisproductPro(gebruiker.email);
    const bijgewerkt = await prisma.gebruiker.update({
      where: { id: gebruiker.id },
      data: {
        emailBevestigdOp: gebruiker.emailBevestigdOp ?? new Date(),
        bevestigTokenHash: null,
        ...(bron ? { pro: true, proBron: bron } : {}),
      },
    });
    // Meteen ingelogd: wie net op de link klikte, hoeft niet nog eens zijn wachtwoord te typen.
    logIn(reply, bijgewerkt);
    return { ok: true };
  });

  app.post("/api/auth/bevestiging-opnieuw", { config: AUTH_LIMIET }, async (request, reply) => {
    const parsed = z.object({ email }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const gebruiker = await prisma.gebruiker.findUnique({ where: { email: parsed.data.email } });
    if (gebruiker && !gebruiker.emailBevestigdOp) {
      const { ruweToken, tokenHash } = maakEenmaligToken();
      await prisma.gebruiker.update({ where: { id: gebruiker.id }, data: { bevestigTokenHash: tokenHash } });
      await verstuurBevestigingsmail(gebruiker.email, gebruiker.naam, `${appUrl()}/bevestigen.html?token=${ruweToken}`);
    }
    return { ok: true };
  });

  app.post("/api/auth/inloggen", { config: AUTH_LIMIET }, async (request, reply) => {
    const parsed = inlogSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const { email, wachtwoord } = parsed.data;

    const gebruiker = await prisma.gebruiker.findUnique({ where: { email } });
    // Eén foutmelding voor "onbekend adres" en "verkeerd wachtwoord".
    if (!gebruiker) return reply.code(401).send({ errorCode: "ONJUISTE_INLOGGEGEVENS" });

    if (gebruiker.vergrendeldTot && gebruiker.vergrendeldTot > new Date()) {
      const minuten = Math.ceil((gebruiker.vergrendeldTot.getTime() - Date.now()) / 60000);
      return reply.code(429).send({
        errorCode: "TE_VEEL_POGINGEN",
        bericht: `Te veel mislukte pogingen. Probeer het over ${minuten} minuten opnieuw.`,
      });
    }

    if (!(await verifieerWachtwoord(gebruiker.wachtwoordHash, wachtwoord))) {
      const pogingen = gebruiker.mislukteInlogpogingen + 1;
      await prisma.gebruiker.update({
        where: { id: gebruiker.id },
        data:
          pogingen >= MAX_POGINGEN
            ? { mislukteInlogpogingen: 0, vergrendeldTot: new Date(Date.now() + VERGRENDELING_MS) }
            : { mislukteInlogpogingen: pogingen },
      });
      return reply.code(401).send({ errorCode: "ONJUISTE_INLOGGEGEVENS" });
    }

    // Pas na het juiste wachtwoord: anders zou dit verraden dat het adres bestaat.
    if (!gebruiker.emailBevestigdOp) return reply.code(403).send({ errorCode: "EMAIL_NIET_BEVESTIGD" });

    await prisma.gebruiker.update({ where: { id: gebruiker.id }, data: { mislukteInlogpogingen: 0, vergrendeldTot: null } });
    logIn(reply, gebruiker);
    return { ok: true };
  });

  app.post("/api/auth/uitloggen", async (_request, reply) => {
    wisSessieCookie(reply);
    return { ok: true };
  });

  app.get("/api/auth/sessie", async (request) => {
    const sessie = await geldigeSessie(request);
    if (!sessie) return { gebruiker: null };
    const gebruiker = await prisma.gebruiker.findUnique({
      where: { id: sessie.gebruikerId },
      select: { email: true, naam: true, rol: true, pro: true, proBron: true },
    });
    // Het eigenaarsaccount is altijd "Pro" in de UI, net als vereistPro() het op de server al
    // altijd doorlaat — zie entitlementsPro.ts.
    return { gebruiker: gebruiker ? { ...gebruiker, pro: gebruiker.rol === "admin" ? true : gebruiker.pro } : null };
  });

  app.post("/api/auth/wachtwoord-vergeten", { config: AUTH_LIMIET }, async (request, reply) => {
    const parsed = z.object({ email }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const gebruiker = await prisma.gebruiker.findUnique({ where: { email: parsed.data.email } });
    if (gebruiker) {
      const { ruweToken, tokenHash } = maakEenmaligToken();
      await prisma.gebruiker.update({
        where: { id: gebruiker.id },
        data: { resetTokenHash: tokenHash, resetTokenVerlooptOp: new Date(Date.now() + RESET_TTL_MS) },
      });
      await verstuurWachtwoordResetMail(gebruiker.email, `${appUrl()}/wachtwoord-resetten.html?token=${ruweToken}`);
    }
    return { ok: true };
  });

  app.post("/api/auth/wachtwoord-resetten", { config: AUTH_LIMIET }, async (request, reply) => {
    const parsed = z.object({ token: z.string().min(1).max(200), wachtwoord: nieuwWachtwoord }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const gebruiker = await prisma.gebruiker.findUnique({ where: { resetTokenHash: hashToken(parsed.data.token) } });
    if (!gebruiker || !gebruiker.resetTokenVerlooptOp || gebruiker.resetTokenVerlooptOp < new Date()) {
      return reply.code(400).send({ errorCode: "TOKEN_ONGELDIG" });
    }
    const bijgewerkt = await prisma.gebruiker.update({
      where: { id: gebruiker.id },
      data: {
        wachtwoordHash: await hashWachtwoord(parsed.data.wachtwoord),
        resetTokenHash: null,
        resetTokenVerlooptOp: null,
        mislukteInlogpogingen: 0,
        vergrendeldTot: null,
        // De resetlink kwam via de mailbox binnen: daarmee is het adres ook bevestigd.
        emailBevestigdOp: gebruiker.emailBevestigdOp ?? new Date(),
        bevestigTokenHash: null,
        // Iemand anders die je oude wachtwoord kende, is nu overal uitgelogd.
        sessieVersie: { increment: 1 },
      },
    });
    logIn(reply, bijgewerkt);
    return { ok: true };
  });

  app.post("/api/auth/wachtwoord", { config: AUTH_LIMIET, preHandler: requireIngelogd }, async (request, reply) => {
    const parsed = wachtwoordSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const gebruiker = await prisma.gebruiker.findUnique({ where: { id: gid(request) } });
    if (!gebruiker || !(await verifieerWachtwoord(gebruiker.wachtwoordHash, parsed.data.huidig))) {
      return reply.code(400).send({ errorCode: "HUIDIG_WACHTWOORD_ONJUIST" });
    }
    // Andere apparaten worden uitgelogd; dit apparaat krijgt meteen een nieuwe sessie.
    const bijgewerkt = await prisma.gebruiker.update({
      where: { id: gebruiker.id },
      data: { wachtwoordHash: await hashWachtwoord(parsed.data.nieuw), sessieVersie: { increment: 1 } },
    });
    logIn(reply, bijgewerkt);
    return { ok: true };
  });
}
