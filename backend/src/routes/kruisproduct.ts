import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { accrdKoppelUrl, claimKruisproductPro, schoonKvkNummer, wisselKoppeltokenIn } from "../luzexKruisproduct.js";
import { AUTH_LIMIET } from "./auth.js";

// Kruisproduct-Pro v2: de klant vult hier zelf zijn kvk-nummer in om gratis Pro te claimen op
// basis van een actief, betalend ACCRD-account. Zie luzexKruisproduct.ts en hub/CLAUDE.md voor
// het volledige mechanisme. Wie al Pro heeft uit een andere bron (een Stripe-abonnement, of een
// cadeau van de eigenaar) wordt geweigerd: anders zou die bron "accrd" worden en trekt
// kruisproductCron.ts zijn Pro in zodra zijn ACCRD-account stopt, terwijl hij gewoon betaalt of
// het cadeau nog geldt (zie hub/CLAUDE.md, "wordt nooit overschreven door deze claim-route").

const claimSchema = z.object({
  kvkNummer: z.string().trim().min(1).max(20),
  code: z.string().trim().min(1).max(40),
  wisselen: z.boolean().optional(),
});

async function kvkAlBijAnder(kvkNummer: string, eigenId: string): Promise<boolean> {
  return Boolean(await prisma.gebruiker.findFirst({ where: { kruisproductKvkNummer: kvkNummer, NOT: { id: eigenId } }, select: { id: true } }));
}

const STATE_COOKIE = "kruisproduct_state";
const STATE_PAD = "/api/account/kruisproduct-koppelen";

export async function kruisproductRoutes(app: FastifyInstance) {
  // "Koppel met ACCRD" (zie luzexKruisproduct.ts). Start: een willekeurige state in een
  // httpOnly-cookie, en de URL van de toestemmingspagina in ACCRD. Afronden: ACCRD stuurde de
  // klant terug met ?accrd_token=…&state=…; alleen als die state gelijk is aan de cookie van
  // deze browser wisselen we het token in.
  app.get(STATE_PAD, { preHandler: requireIngelogd }, async () => ({ beschikbaar: accrdKoppelUrl("x".repeat(32)) !== null }));

  app.post(`${STATE_PAD}/start`, { preHandler: requireIngelogd }, async (request, reply) => {
    const huidig = await prisma.gebruiker.findUniqueOrThrow({ where: { id: gid(request) } });
    if (huidig.pro && huidig.proBron !== "accrd") {
      return reply.code(409).send({ errorCode: "AL_PRO", bericht: "Je hebt al Pro." });
    }
    const state = randomBytes(24).toString("base64url");
    const url = accrdKoppelUrl(state);
    if (!url) {
      return reply.code(502).send({ errorCode: "KRUISPRODUCT_NIET_BESCHIKBAAR", bericht: "Koppelen met ACCRD kan nu niet. Vul je KvK-nummer en koppelcode hieronder in." });
    }
    reply.setCookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: STATE_PAD,
      maxAge: 15 * 60,
    });
    return { url };
  });

  const afrondSchema = z.object({ token: z.string().min(20).max(200), state: z.string().min(16).max(128) });

  app.post(`${STATE_PAD}/afronden`, { preHandler: requireIngelogd, config: AUTH_LIMIET }, async (request, reply) => {
    const parsed = afrondSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ errorCode: "ONGELDIGE_INVOER" });
    const cookieState = Buffer.from(request.cookies[STATE_COOKIE] ?? "");
    reply.clearCookie(STATE_COOKIE, { path: STATE_PAD });
    const state = Buffer.from(parsed.data.state);
    if (cookieState.length !== state.length || !timingSafeEqual(cookieState, state)) {
      return reply.code(400).send({ errorCode: "KOPPELING_VERLOPEN", bericht: "Deze koppeling is verlopen of in een andere browser begonnen. Tik opnieuw op Koppel met ACCRD." });
    }

    // Zelfde regel als bij de claim met KvK-nummer: een andere Pro-bron wordt nooit overschreven.
    const huidig = await prisma.gebruiker.findUniqueOrThrow({ where: { id: gid(request) } });
    if (huidig.pro && huidig.proBron !== "accrd") {
      return reply.code(409).send({ errorCode: "AL_PRO", bericht: "Je hebt al Pro." });
    }

    const resultaat = await wisselKoppeltokenIn(parsed.data.token, parsed.data.state);
    if (resultaat.status === "toegekend") {
      const kvkNummer = schoonKvkNummer(resultaat.kvkNummer);
      if (await kvkAlBijAnder(kvkNummer, huidig.id)) {
        return reply.code(409).send({ errorCode: "KVK_AL_GEKOPPELD", bericht: "Dit ACCRD-account is al gekoppeld aan een ander RSLNT-account." });
      }
      await prisma.gebruiker.update({ where: { id: huidig.id }, data: { pro: true, proBron: "accrd", kruisproductKvkNummer: kvkNummer } });
      return { ok: true };
    }
    if (resultaat.status === "al_gekozen") {
      return reply.code(409).send({ errorCode: "AL_GEKOZEN", huidigeKeuze: resultaat.huidigeKeuze, bericht: "Je ACCRD-account heeft gratis Pro al op CMMNTY. Tik opnieuw op Koppel met ACCRD en kies daar voor wisselen." });
    }
    if (resultaat.status === "niet_actief") {
      return reply.code(400).send({ errorCode: "NIET_ACTIEF", bericht: "Je ACCRD-account heeft op dit moment geen actief, betalend abonnement." });
    }
    if (resultaat.status === "ongeldig") {
      return reply.code(400).send({ errorCode: "KOPPELING_VERLOPEN", bericht: "Deze koppeling is verlopen of al gebruikt. Tik opnieuw op Koppel met ACCRD." });
    }
    return reply.code(502).send({ errorCode: "KRUISPRODUCT_NIET_BESCHIKBAAR", bericht: "Even niet te controleren. Probeer het later opnieuw." });
  });


  // Strenge limiet: met deze route zou je anders koppelcodes kunnen raden.
  app.post("/api/account/kruisproduct-claim", { preHandler: requireIngelogd, config: AUTH_LIMIET }, async (request, reply) => {
    const parsed = claimSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ errorCode: "ONGELDIGE_INVOER" });
    const kvkNummer = schoonKvkNummer(parsed.data.kvkNummer);
    const { wisselen } = parsed.data;

    const huidig = await prisma.gebruiker.findUniqueOrThrow({ where: { id: gid(request) } });
    if (huidig.pro && huidig.proBron !== "accrd") {
      return reply.code(409).send({ errorCode: "AL_PRO", bericht: "Je hebt al Pro." });
    }

    const resultaat = await claimKruisproductPro(kvkNummer, parsed.data.code, wisselen);

    if (resultaat.status === "toegekend") {
      // kruisproductKvkNummer is uniek; zonder deze controle gaf een tweede account met hetzelfde
      // KvK-nummer een onverwerkte databasefout (500) in plaats van een uitleg.
      if (await kvkAlBijAnder(kvkNummer, gid(request))) {
        return reply.code(409).send({ errorCode: "KVK_AL_GEKOPPELD", bericht: "Dit ACCRD-account is al gekoppeld aan een ander RSLNT-account." });
      }
      await prisma.gebruiker.update({
        where: { id: gid(request) },
        data: { pro: true, proBron: "accrd", kruisproductKvkNummer: kvkNummer },
      });
      return { ok: true };
    }

    if (resultaat.status === "al_gekozen") {
      // Doorgeven wat ACCRD teruggaf, niet hardcoden: ClaimResultaat laat "cmmnty" én "rslnt"
      // toe en een hardcoded waarde zou hier een fout antwoord geven zodra dat ooit "rslnt" is.
      return reply.code(409).send({ errorCode: "AL_GEKOZEN", huidigeKeuze: resultaat.huidigeKeuze });
    }

    if (resultaat.status === "niet_actief") {
      return reply.code(400).send({
        errorCode: "NIET_ACTIEF",
        bericht: "Dit KvK-nummer en deze koppelcode horen niet bij een actief, betalend ACCRD-account. Kijk in ACCRD onder Mijn abonnement.",
      });
    }

    // "fout": ACCRD niet bereikbaar of niet geconfigureerd. Geen 400 (dat is de klant z'n
    // schuld niet) en geen 503 op /api/account (dat zou de rest van de sessie-check laten
    // lijken alsof RSLNT zelf plat ligt) — gewoon 502, duidelijk "probeer het later opnieuw".
    return reply.code(502).send({
      errorCode: "KRUISPRODUCT_NIET_BESCHIKBAAR",
      bericht: "Kon dit kvk-nummer nu niet controleren. Probeer het later opnieuw.",
    });
  });
}
