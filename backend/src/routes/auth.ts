import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { hashWachtwoord, maakSessieToken, verifieerWachtwoord } from "../auth.js";
import { leesSessie, requireIngelogd, wisSessieCookie, zetSessieCookie } from "../plugins/requireAuth.js";

// Strenge limiet waar een aanvaller iets te winnen heeft. Ruim genoeg voor een mens die zich
// vertypt, te krap voor een script. Plus vergrendeling na vijf missers, zoals ACCRD.
const AUTH_LIMIET = { rateLimit: { max: 10, timeWindow: "15 minutes" } };
const MAX_POGINGEN = 5;
const VERGRENDELING_MS = 15 * 60 * 1000;

const inlogSchema = z.object({
  email: z.string().trim().toLowerCase().email("Ongeldig e-mailadres"),
  wachtwoord: z.string().min(1),
});

const wachtwoordSchema = z.object({
  huidig: z.string().min(1),
  nieuw: z.string().min(10, "Nieuw wachtwoord moet minimaal 10 tekens zijn").max(200),
});

export function ongeldig(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({ errorCode: "ONGELDIGE_INVOER", details: error.flatten().fieldErrors });
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/api/auth/inloggen", { config: AUTH_LIMIET }, async (request, reply) => {
    const parsed = inlogSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const { email, wachtwoord } = parsed.data;

    const gebruiker = await prisma.gebruiker.findUnique({ where: { email } });
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

    await prisma.gebruiker.update({
      where: { id: gebruiker.id },
      data: { mislukteInlogpogingen: 0, vergrendeldTot: null },
    });
    zetSessieCookie(reply, maakSessieToken({ gebruikerId: gebruiker.id, email: gebruiker.email }));
    return { ok: true };
  });

  app.post("/api/auth/uitloggen", async (_request, reply) => {
    wisSessieCookie(reply);
    return { ok: true };
  });

  app.get("/api/auth/sessie", async (request) => {
    const sessie = leesSessie(request);
    if (!sessie) return { gebruiker: null };
    const gebruiker = await prisma.gebruiker.findUnique({
      where: { id: sessie.gebruikerId },
      select: { email: true, naam: true },
    });
    return { gebruiker };
  });

  app.post("/api/auth/wachtwoord", { config: AUTH_LIMIET, preHandler: requireIngelogd }, async (request, reply) => {
    const parsed = wachtwoordSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const gebruiker = await prisma.gebruiker.findUnique({ where: { id: request.gebruiker!.gebruikerId } });
    if (!gebruiker || !(await verifieerWachtwoord(gebruiker.wachtwoordHash, parsed.data.huidig))) {
      return reply.code(400).send({ errorCode: "HUIDIG_WACHTWOORD_ONJUIST" });
    }
    await prisma.gebruiker.update({
      where: { id: gebruiker.id },
      data: { wachtwoordHash: await hashWachtwoord(parsed.data.nieuw) },
    });
    return { ok: true };
  });
}
