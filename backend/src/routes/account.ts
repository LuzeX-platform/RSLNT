import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { verifieerWachtwoord } from "../auth.js";
import { vandaag } from "../datum.js";
import { gid, requireIngelogd, wisSessieCookie } from "../plugins/requireAuth.js";
import { AUTH_LIMIET, ongeldig } from "./auth.js";
import { stripeClient } from "../stripe.js";

// Je account en je rechten onder de AVG: je naam wijzigen, al je gegevens downloaden (inzage en
// overdraagbaarheid) en je account met alles verwijderen.

/** Alles wat RSLNT van één account bewaart, behalve het wachtwoord en de tokens. */
export async function alleGegevens(gebruikerId: string) {
  const [gebruiker, profiel, voorkeuren, gewichten, metingen, herstelchecks, oefeningen, programmas, trainingen, duurtrainingen, pijnnotities, deellinks, planning] = await Promise.all([
    prisma.gebruiker.findUniqueOrThrow({
      where: { id: gebruikerId },
      select: { naam: true, email: true, rol: true, pro: true, aangemaaktOp: true, emailBevestigdOp: true, toestemmingOp: true, privacyVersie: true },
    }),
    prisma.profiel.findUnique({ where: { gebruikerId } }),
    prisma.voorkeuren.findUnique({ where: { gebruikerId } }),
    prisma.lichaamsgewicht.findMany({ where: { gebruikerId }, orderBy: { datum: "asc" } }),
    prisma.lichaamsmeting.findMany({ where: { gebruikerId }, orderBy: { datum: "asc" } }),
    prisma.herstelcheck.findMany({ where: { gebruikerId }, orderBy: { datum: "asc" } }),
    prisma.oefening.findMany({ where: { gebruikerId }, orderBy: { naam: "asc" } }),
    prisma.programma.findMany({
      where: { gebruikerId },
      include: { schemas: { orderBy: { volgorde: "asc" }, include: { oefeningen: { orderBy: { volgorde: "asc" } } } } },
    }),
    prisma.training.findMany({
      where: { gebruikerId },
      orderBy: { datum: "asc" },
      include: { oefeningen: { orderBy: { volgorde: "asc" }, include: { sets: { orderBy: { nummer: "asc" } } } } },
    }),
    prisma.duurtraining.findMany({ where: { gebruikerId }, orderBy: { datum: "asc" } }),
    prisma.pijnnotitie.findMany({ where: { gebruikerId }, orderBy: { datum: "asc" } }),
    // Zonder de tokenhash: die zegt niemand iets en hoort niet in een bestand dat je doorstuurt.
    prisma.deellink.findMany({
      where: { gebruikerId },
      orderBy: { aangemaaktOp: "asc" },
      select: { naam: true, onderdelen: true, aangemaaktOp: true, verlooptOp: true, ingetrokkenOp: true, laatstBekekenOp: true },
    }),
    prisma.planning.findMany({
      where: { gebruikerId },
      orderBy: { weekdag: "asc" },
      select: { weekdag: true, tijd: true, schema: { select: { naam: true } } },
    }),
  ]);
  return {
    toelichting: "Al je gegevens uit LuzeX RSLNT. Datums in UTC. Zie /privacy.html voor wat we bewaren en waarom.",
    gedownloadOp: new Date().toISOString(),
    account: gebruiker,
    profiel,
    voorkeuren,
    lichaamsgewicht: gewichten,
    lichaamsmetingen: metingen,
    herstelchecks,
    oefeningen,
    programmas,
    trainingen,
    duurtrainingen,
    pijnnotities,
    deellinks,
    weekplanning: planning.map((p) => ({ weekdag: p.weekdag, tijd: p.tijd, training: p.schema.naam })),
  };
}

/**
 * Verwijdert een account met alles erop en eraan, in een volgorde die de verwijzingen tussen
 * trainingen, schema's en oefeningen respecteert. Heeft iemand een lopend Pro-abonnement, dan
 * zegt deze dat eerst bij Stripe op — anders zou iemand kunnen blijven betalen voor een account
 * dat niet meer bestaat. Lukt dat niet (Stripe niet bereikbaar, al opgezegd), dan gaat de
 * accountverwijdering gewoon door; de webhook ruimt stripeAbonnementId dan later zelf op.
 */
export async function verwijderAccount(gebruikerId: string) {
  const g = await prisma.gebruiker.findUnique({ where: { id: gebruikerId }, select: { stripeAbonnementId: true } });
  const stripe = stripeClient();
  if (stripe && g?.stripeAbonnementId) {
    await stripe.subscriptions.cancel(g.stripeAbonnementId).catch(() => {});
  }
  await prisma.$transaction([
    prisma.planning.deleteMany({ where: { gebruikerId } }),
    prisma.training.deleteMany({ where: { gebruikerId } }),
    prisma.programma.deleteMany({ where: { gebruikerId } }),
    prisma.oefening.deleteMany({ where: { gebruikerId } }),
    prisma.lichaamsgewicht.deleteMany({ where: { gebruikerId } }),
    prisma.lichaamsmeting.deleteMany({ where: { gebruikerId } }),
    prisma.herstelcheck.deleteMany({ where: { gebruikerId } }),
    prisma.profiel.deleteMany({ where: { gebruikerId } }),
    prisma.voorkeuren.deleteMany({ where: { gebruikerId } }),
    prisma.duurtraining.deleteMany({ where: { gebruikerId } }),
    prisma.pijnnotitie.deleteMany({ where: { gebruikerId } }),
    prisma.deellink.deleteMany({ where: { gebruikerId } }),
    prisma.gebruiker.delete({ where: { id: gebruikerId } }),
  ]);
}

export async function accountRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);

  // Afgerond of overgeslagen: allebei "gezien". Opnieuw bekijken kan via Account (/?uitleg=1) en
  // verandert hier niets meer.
  app.post("/api/account/rondleiding-gezien", async (request) => {
    await prisma.gebruiker.updateMany({
      where: { id: gid(request), rondleidingGezienOp: null },
      data: { rondleidingGezienOp: new Date() },
    });
    return { ok: true };
  });

  app.put("/api/account", async (request, reply) => {
    const parsed = z.object({ naam: z.string().trim().min(1, "Vul je naam in").max(60) }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    await prisma.gebruiker.update({ where: { id: gid(request) }, data: { naam: parsed.data.naam } });
    return { ok: true };
  });

  app.get("/api/account/export", async (request, reply) => {
    reply.header("Content-Disposition", `attachment; filename="rslnt-gegevens-${vandaag()}.json"`);
    reply.header("Cache-Control", "no-store");
    return alleGegevens(gid(request));
  });

  app.delete("/api/account", { config: AUTH_LIMIET }, async (request, reply) => {
    const parsed = z.object({ wachtwoord: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const gebruiker = await prisma.gebruiker.findUniqueOrThrow({ where: { id: gid(request) } });
    // Het eigenaarsaccount beheert de app; dat verdwijnt niet met één klik.
    if (gebruiker.rol === "admin") return reply.code(400).send({ errorCode: "ADMIN_NIET_VERWIJDERBAAR" });
    if (!(await verifieerWachtwoord(gebruiker.wachtwoordHash, parsed.data.wachtwoord))) {
      return reply.code(400).send({ errorCode: "HUIDIG_WACHTWOORD_ONJUIST" });
    }
    await verwijderAccount(gebruiker.id);
    wisSessieCookie(reply);
    return { ok: true };
  });
}
