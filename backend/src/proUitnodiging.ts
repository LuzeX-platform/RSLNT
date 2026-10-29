import { prisma } from "./db.js";

/**
 * Wisselt een openstaand Pro-cadeau in voor dit account, als er een is. Aangeroepen op het moment
 * dat een e-mailadres bevestigd raakt (bevestigingslink of resetlink): pas dan is bewezen dat het
 * adres van deze persoon is. Een account dat al Pro heeft (betaald, via ACCRD) laat het cadeau
 * open staan in plaats van zijn bron te overschrijven — anders zou de bron van een betalende klant
 * ineens "handmatig" worden.
 */
export async function wisselProUitnodigingIn(gebruiker: { id: string; email: string; pro: boolean; rol: string }): Promise<boolean> {
  if (gebruiker.rol !== "lid" || gebruiker.pro) return false;
  const uitnodiging = await prisma.proUitnodiging.findUnique({ where: { email: gebruiker.email } });
  if (!uitnodiging || uitnodiging.ingewisseldOp || uitnodiging.ingetrokkenOp) return false;
  await prisma.$transaction([
    // kruisproductKvkNummer op null om dezelfde reden als bij "Pro geven" in routes/admin.ts.
    prisma.gebruiker.update({ where: { id: gebruiker.id }, data: { pro: true, proBron: "handmatig", kruisproductKvkNummer: null } }),
    prisma.proUitnodiging.update({ where: { id: uitnodiging.id }, data: { ingewisseldOp: new Date() } }),
  ]);
  return true;
}
