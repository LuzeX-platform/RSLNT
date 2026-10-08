import "dotenv/config";
import { prisma } from "./db.js";
import { controleerKruisproductStatus } from "./luzexKruisproduct.js";

// Draait dagelijks als losse Render-cronjob (zie render.yaml). Het filter op
// kruisproductKvkNummer (niet proBron) is de hele veiligheid hier: een echt betaald
// Stripe-abonnement (routes/abonnement.ts) zet dat veld nooit, dus die rijen komen deze query
// nooit tegen, hoe vaak hij ook draait. Wie zijn ACCRD-koppeling kwijtraakt verliest hier zijn
// gratis RSLNT-Pro weer; wie opnieuw gekoppeld is sinds de vorige run, krijgt 'm hier terug.
async function main() {
  const gebruikers = await prisma.gebruiker.findMany({
    where: { kruisproductKvkNummer: { not: null } },
    select: { id: true, pro: true, kruisproductKvkNummer: true },
  });
  let ingetrokken = 0;
  let bevestigd = 0;
  for (const g of gebruikers) {
    // not-null gefilterd in de query hierboven, maar TypeScript weet dat niet.
    const actief = await controleerKruisproductStatus(g.kruisproductKvkNummer!);
    if (actief) {
      if (!g.pro) {
        await prisma.gebruiker.update({ where: { id: g.id }, data: { pro: true, proBron: "accrd" } });
      }
      bevestigd++;
    } else {
      await prisma.gebruiker.update({
        where: { id: g.id },
        data: { pro: false, proBron: null, kruisproductKvkNummer: null },
      });
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
