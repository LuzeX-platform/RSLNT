import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";
import { claimKruisproductPro, schoonKvkNummer } from "../luzexKruisproduct.js";

// Kruisproduct-Pro v2: de klant vult hier zelf zijn kvk-nummer in om gratis Pro te claimen op
// basis van een actief, betalend ACCRD-account. Zie luzexKruisproduct.ts en hub/CLAUDE.md voor
// het volledige mechanisme. Wie al Pro heeft uit een andere bron (een Stripe-abonnement, of een
// cadeau van de eigenaar) wordt geweigerd: anders zou die bron "accrd" worden en trekt
// kruisproductCron.ts zijn Pro in zodra zijn ACCRD-account stopt, terwijl hij gewoon betaalt of
// het cadeau nog geldt (zie hub/CLAUDE.md, "wordt nooit overschreven door deze claim-route").

const claimSchema = z.object({
  kvkNummer: z.string().trim().min(1).max(20),
  wisselen: z.boolean().optional(),
});

export async function kruisproductRoutes(app: FastifyInstance) {
  app.post("/api/account/kruisproduct-claim", { preHandler: requireIngelogd }, async (request, reply) => {
    const parsed = claimSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ errorCode: "ONGELDIGE_INVOER" });
    const kvkNummer = schoonKvkNummer(parsed.data.kvkNummer);
    const { wisselen } = parsed.data;

    const huidig = await prisma.gebruiker.findUniqueOrThrow({ where: { id: gid(request) } });
    if (huidig.pro && huidig.proBron !== "accrd") {
      return reply.code(409).send({ errorCode: "AL_PRO", bericht: "Je hebt al Pro." });
    }

    const resultaat = await claimKruisproductPro(kvkNummer, wisselen);

    if (resultaat.status === "toegekend") {
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
        bericht: "Dit KvK-nummer is niet gekoppeld aan een actief, betalend ACCRD-account.",
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
