import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { requireAdmin, requireIngelogd } from "../plugins/requireAuth.js";

// Alleen voor het eigenaarsaccount: hoeveel mensen zich hebben aangemeld, hoeveel daarvan hun
// e-mailadres bevestigd hebben, en hoeveel Pro hebben (betaald, of via Kruisproduct-Pro — zie
// hub/CLAUDE.md). Geen wachtwoorden, geen trainings- of gezondheidsdata: dit is uitsluitend het
// aantal en de status van de accounts zelf.

export async function adminRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);
  app.addHook("preHandler", requireAdmin);

  app.get("/api/admin/overzicht", async () => {
    const [totaal, bevestigd, pro, proViaAccrd, proViaScrnn, recent] = await Promise.all([
      prisma.gebruiker.count({ where: { rol: "lid" } }),
      prisma.gebruiker.count({ where: { rol: "lid", emailBevestigdOp: { not: null } } }),
      prisma.gebruiker.count({ where: { rol: "lid", pro: true } }),
      prisma.gebruiker.count({ where: { rol: "lid", pro: true, proBron: "accrd" } }),
      prisma.gebruiker.count({ where: { rol: "lid", pro: true, proBron: "scrnn" } }),
      prisma.gebruiker.findMany({
        where: { rol: "lid" },
        orderBy: { aangemaaktOp: "desc" },
        take: 50,
        select: { naam: true, email: true, emailBevestigdOp: true, pro: true, proBron: true, aangemaaktOp: true },
      }),
    ]);
    return {
      totaal,
      bevestigd,
      onbevestigd: totaal - bevestigd,
      pro,
      proBetaald: pro - proViaAccrd - proViaScrnn,
      proViaAccrd,
      proViaScrnn,
      recent,
    };
  });
}
