import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "./db.js";
import { gid } from "./plugins/requireAuth.js";

// FAIL-CLOSED, in tegenstelling tot ACCRD's entitlements.ts (die fail-open is). Daar gaat het
// om bestaande, betalende organisaties waar een ontbrekend abonnementsrecord een bug is; hier
// gaat het om de paywall zélf — een onbekende of ontbrekende status betekent dus gewoon "nog
// geen Pro", niet "toegang bij twijfel".
//
// Het eigenaarsaccount (rol admin, uit de seed) betaalt zichzelf niet: dat is geen abonnement
// maar de uitbater van de app.

/** Heeft dit account nu Pro? Het eigenaarsaccount altijd; anders alleen bij `pro: true`. */
export async function heeftPro(gebruikerId: string): Promise<boolean> {
  const gebruiker = await prisma.gebruiker.findUnique({ where: { id: gebruikerId }, select: { pro: true, rol: true } });
  return gebruiker?.rol === "admin" || gebruiker?.pro === true;
}

/** preHandler voor routes achter de Pro-paywall. Alleen te gebruiken ná requireIngelogd. */
export async function vereistPro(request: FastifyRequest, reply: FastifyReply) {
  if (request.gebruiker?.rol === "admin") return;
  if (!(await heeftPro(gid(request)))) {
    return reply.code(402).send({
      errorCode: "PRO_VEREIST",
      bericht: "Dit onderdeel is voor Pro-leden. Upgrade op /pro.html om verder te gaan.",
    });
  }
}
