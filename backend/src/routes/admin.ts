import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireAdmin, requireIngelogd } from "../plugins/requireAuth.js";

// Alleen voor het eigenaarsaccount: hoeveel mensen zich hebben aangemeld, hoeveel daarvan hun
// e-mailadres bevestigd hebben, en hoeveel Pro hebben (betaald, of via Kruisproduct-Pro — zie
// hub/CLAUDE.md). Geen wachtwoorden, geen trainings- of gezondheidsdata: dit is uitsluitend het
// aantal en de status van de accounts zelf.
//
// Daarnaast kan de eigenaar iemand Pro cadeau geven (proBron "handmatig"). Dat is een vierde
// bron naast Stripe, Kruisproduct-Pro en het eigenaarsaccount zelf, en de route raakt bewust
// alleen die eigen bron aan: een betaald abonnement of Pro via ACCRD trekt hij nooit in, anders
// verliest een echte klant zijn Pro door een klik in het beheer.

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);
  app.addHook("preHandler", requireAdmin);

  app.get("/api/admin/overzicht", async () => {
    const [totaal, bevestigd, pro, proViaAccrd, proViaScrnn, proCadeau, recent, uitnodigingen] = await Promise.all([
      prisma.gebruiker.count({ where: { rol: "lid" } }),
      prisma.gebruiker.count({ where: { rol: "lid", emailBevestigdOp: { not: null } } }),
      prisma.gebruiker.count({ where: { rol: "lid", pro: true } }),
      prisma.gebruiker.count({ where: { rol: "lid", pro: true, proBron: "accrd" } }),
      prisma.gebruiker.count({ where: { rol: "lid", pro: true, proBron: "scrnn" } }),
      prisma.gebruiker.count({ where: { rol: "lid", pro: true, proBron: "handmatig" } }),
      prisma.gebruiker.findMany({
        where: { rol: "lid" },
        orderBy: { aangemaaktOp: "desc" },
        take: 200,
        select: { id: true, naam: true, email: true, emailBevestigdOp: true, pro: true, proBron: true, aangemaaktOp: true },
      }),
      prisma.proUitnodiging.findMany({
        where: { ingewisseldOp: null, ingetrokkenOp: null },
        orderBy: { aangemaaktOp: "desc" },
        select: { id: true, email: true, aangemaaktOp: true },
      }),
    ]);
    return {
      totaal,
      bevestigd,
      onbevestigd: totaal - bevestigd,
      pro,
      proBetaald: pro - proViaAccrd - proViaScrnn - proCadeau,
      proViaAccrd,
      proViaScrnn,
      proCadeau,
      recent,
      uitnodigingen,
    };
  });

  // Pro cadeau geven op e-mailadres. Heeft het adres al een bevestigd account, dan krijgt dat
  // meteen Pro; anders blijft het cadeau klaarstaan tot iemand dat adres bevestigt (zie
  // proUitnodiging.ts). Een onbevestigd account krijgt het dus ook pas na bevestigen.
  app.post("/api/admin/pro-uitnodigingen", async (request, reply) => {
    const parsed = z.object({ email: z.string().trim().toLowerCase().email().max(200) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ errorCode: "ONGELDIGE_INVOER", bericht: "Vul een geldig e-mailadres in." });
    const { email } = parsed.data;

    const gebruiker = await prisma.gebruiker.findUnique({ where: { email } });
    if (gebruiker?.rol === "admin") return reply.code(409).send({ errorCode: "AL_PRO", bericht: "Dit is het eigenaarsaccount: dat heeft altijd Pro." });
    if (gebruiker?.pro) return reply.code(409).send({ errorCode: "AL_PRO", bericht: "Dit account heeft al Pro." });
    if (gebruiker?.emailBevestigdOp) {
      await prisma.gebruiker.update({ where: { id: gebruiker.id }, data: { pro: true, proBron: "handmatig", kruisproductKvkNummer: null } });
      return { status: "toegekend" };
    }

    // Opnieuw uitnodigen na intrekken zet dezelfde rij weer open (email is uniek).
    await prisma.proUitnodiging.upsert({
      where: { email },
      create: { email },
      update: { aangemaaktOp: new Date(), ingewisseldOp: null, ingetrokkenOp: null },
    });
    return { status: "klaargezet" };
  });

  app.post("/api/admin/pro-uitnodigingen/:id/intrekken", async (request, reply) => {
    const { id } = request.params as { id: string };
    const uitnodiging = await prisma.proUitnodiging.findUnique({ where: { id } });
    if (!uitnodiging) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    if (!uitnodiging.ingewisseldOp && !uitnodiging.ingetrokkenOp) {
      await prisma.proUitnodiging.update({ where: { id }, data: { ingetrokkenOp: new Date() } });
    }
    return { ok: true };
  });

  app.patch("/api/admin/gebruikers/:id/pro", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = z.object({ pro: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ errorCode: "ONGELDIGE_INVOER" });

    const gebruiker = await prisma.gebruiker.findUnique({ where: { id } });
    if (!gebruiker || gebruiker.rol !== "lid") return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });

    if (parsed.data.pro) {
      if (gebruiker.pro) {
        return reply.code(409).send({ errorCode: "AL_PRO", bericht: "Dit account heeft al Pro." });
      }
      // kruisproductKvkNummer op null: anders trekt kruisproductCron.ts het cadeau de volgende
      // ochtend weer in, puur omdat er ooit een kvk-nummer geclaimd is (zie hub/CLAUDE.md).
      await prisma.gebruiker.update({
        where: { id },
        data: { pro: true, proBron: "handmatig", kruisproductKvkNummer: null },
      });
      return { ok: true };
    }

    if (!gebruiker.pro) return { ok: true };
    if (gebruiker.proBron !== "handmatig") {
      return reply.code(409).send({
        errorCode: "PRO_NIET_HANDMATIG",
        bericht: "Deze Pro komt van een betaald abonnement of via ACCRD. Die kun je hier niet intrekken.",
      });
    }
    await prisma.gebruiker.update({ where: { id }, data: { pro: false, proBron: null } });
    return { ok: true };
  });
}
