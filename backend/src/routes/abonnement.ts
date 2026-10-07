import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { prisma } from "../db.js";
import { appUrl } from "../mailer.js";
import { proPrijsId, stripeClient } from "../stripe.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";

// Checkout en Billing Portal zijn allebei door Stripe gehost: we sturen de gebruiker naar een
// Stripe-URL en nooit zelf kaartgegevens aan. Dat is ook waarom de CSP (app.ts) geen frame-src
// of script-src voor Stripe nodig heeft — er draait hier geen Stripe.js, alleen een redirect.
//
// De Pro-status zelf wordt NERGENS in deze route gezet: dat gebeurt uitsluitend in de webhook
// hieronder, op basis van een door Stripe ondertekende gebeurtenis. Een checkout-redirect
// terug naar de app betekent dus nog niet per se dat de betaling al verwerkt is; de webhook
// loopt er vrijwel altijd voor, maar de /pro.html-pagina leest de sessie opnieuw in plaats van
// de betaling zelf te vertrouwen.

export async function abonnementRoutes(app: FastifyInstance) {
  app.post("/api/abonnement/checkout", { preHandler: requireIngelogd }, async (request, reply) => {
    const stripe = stripeClient();
    if (!stripe) return reply.code(503).send({ errorCode: "ABONNEMENT_NIET_BESCHIKBAAR", bericht: "Betalen is op dit moment niet beschikbaar." });

    const g = await prisma.gebruiker.findUniqueOrThrow({ where: { id: gid(request) } });
    if (g.pro) return { url: `${appUrl()}/pro.html` };

    // Eén Stripe-klant per gebruiker, hergebruikt bij een tweede poging (bijv. na het annuleren
    // van de eerste checkout).
    let stripeKlantId = g.stripeKlantId;
    if (!stripeKlantId) {
      const klant = await stripe.customers.create({ email: g.email, name: g.naam, metadata: { gebruikerId: g.id } });
      stripeKlantId = klant.id;
      await prisma.gebruiker.update({ where: { id: g.id }, data: { stripeKlantId } });
    }

    const sessie = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: stripeKlantId,
      line_items: [{ price: proPrijsId(), quantity: 1 }],
      success_url: `${appUrl()}/pro.html?afgerekend=1`,
      cancel_url: `${appUrl()}/pro.html`,
      // Niet strikt nodig naast customer.metadata, maar zo hoeft de webhook niet op een
      // tussenliggende Stripe-lookup te vertrouwen om van customer naar gebruikerId te komen.
      subscription_data: { metadata: { gebruikerId: g.id } },
    });
    if (!sessie.url) return reply.code(502).send({ errorCode: "ABONNEMENT_MISLUKT", bericht: "Kon geen betaalpagina openen. Probeer het opnieuw." });
    return { url: sessie.url };
  });

  app.post("/api/abonnement/portaal", { preHandler: requireIngelogd }, async (request, reply) => {
    const stripe = stripeClient();
    if (!stripe) return reply.code(503).send({ errorCode: "ABONNEMENT_NIET_BESCHIKBAAR", bericht: "Abonnement beheren is op dit moment niet beschikbaar." });
    const g = await prisma.gebruiker.findUniqueOrThrow({ where: { id: gid(request) } });
    if (!g.stripeKlantId) return reply.code(404).send({ errorCode: "GEEN_ABONNEMENT", bericht: "Je hebt nog geen abonnement om te beheren." });
    const sessie = await stripe.billingPortal.sessions.create({ customer: g.stripeKlantId, return_url: `${appUrl()}/pro.html` });
    return { url: sessie.url };
  });

  // Geen requireIngelogd: Stripe roept dit zelf aan, met een handtekening in plaats van onze
  // sessiecookie. De CSRF-Origin-check in app.ts raakt dit niet — die kijkt alleen naar een
  // Origin-header, en Stripe's server-naar-server-request stuurt er geen mee.
  app.post("/api/stripe/webhook", { config: { rawBody: true } }, async (request, reply) => {
    const stripe = stripeClient();
    const geheim = process.env.STRIPE_WEBHOOK_GEHEIM;
    if (!stripe || !geheim) return reply.code(503).send({ errorCode: "ABONNEMENT_NIET_BESCHIKBAAR" });

    const handtekening = request.headers["stripe-signature"];
    if (typeof handtekening !== "string" || !request.rawBody) {
      return reply.code(400).send({ errorCode: "ONGELDIGE_HANDTEKENING" });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(request.rawBody, handtekening, geheim);
    } catch {
      return reply.code(400).send({ errorCode: "ONGELDIGE_HANDTEKENING" });
    }

    switch (event.type) {
      // Na een geslaagde checkout staat de subscription al op "active" (of "trialing"); we
      // hoeven hier dus niet apart op de eerste betaling te wachten.
      case "checkout.session.completed": {
        const sessie = event.data.object as Stripe.Checkout.Session;
        if (sessie.mode === "subscription" && typeof sessie.customer === "string" && typeof sessie.subscription === "string") {
          await prisma.gebruiker.updateMany({
            where: { stripeKlantId: sessie.customer },
            data: { pro: true, stripeAbonnementId: sessie.subscription },
          });
        }
        break;
      }
      // Dekt zowel een hernieuwing als een opzegging (status gaat naar canceled) als een
      // mislukte incasso (past_due/unpaid): de Pro-status volgt steeds de actuele Stripe-status.
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const abonnement = event.data.object as Stripe.Subscription;
        if (typeof abonnement.customer === "string") {
          const actief = abonnement.status === "active" || abonnement.status === "trialing";
          await prisma.gebruiker.updateMany({
            where: { stripeKlantId: abonnement.customer },
            data: { pro: actief, stripeAbonnementId: actief ? abonnement.id : null },
          });
        }
        break;
      }
    }

    return { ontvangen: true };
  });
}
