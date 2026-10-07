import "dotenv/config";
import { prisma } from "./db.js";
import { controleerKruisproductPro } from "./luzexEntitlement.js";

// Draait dagelijks als losse Render-cronjob (zie render.yaml). Alleen gebruikers met proBron
// gezet komen hier aan bod — een betaald Stripe-abonnement (proBron null, zie
// routes/abonnement.ts) raakt dit script nooit aan. Wie zijn ACCRD- of SCRNN-account kwijtraakt
// verliest hier zijn gratis RSLNT-Pro weer; wie een nieuwe koppeling kreeg sinds de vorige run,
// krijgt 'm hier alsnog.
async function main() {
  const gebruikers = await prisma.gebruiker.findMany({
    where: { proBron: { not: null } },
    select: { id: true, email: true, pro: true, proBron: true },
  });
  let ingetrokken = 0;
  let bevestigd = 0;
  for (const g of gebruikers) {
    const bron = await controleerKruisproductPro(g.email);
    if (bron) {
      if (!g.pro || g.proBron !== bron) {
        await prisma.gebruiker.update({ where: { id: g.id }, data: { pro: true, proBron: bron } });
      }
      bevestigd++;
    } else {
      await prisma.gebruiker.update({ where: { id: g.id }, data: { pro: false, proBron: null } });
      ingetrokken++;
    }
  }
  console.log(`[kruisproduct] ${gebruikers.length} gecontroleerd, ${bevestigd} nog actief, ${ingetrokken} ingetrokken.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
