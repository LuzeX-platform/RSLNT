import "dotenv/config";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "./db.js";
import { hashWachtwoord } from "./auth.js";
import { importeerProgramma, valideerProgramma } from "./programmaImport.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Werkt vanuit src/ (tsx) en dist/ (productie): beide liggen één niveau onder backend/.
const STANDAARD_PROGRAMMA = path.join(__dirname, "..", "programmas", "benen-push-pull.json");

// Maakt jouw account aan en laadt het meegeleverde programma in. Idempotent — draait bij elke
// opstart (zie Dockerfile), zelfde patroon als ACCRD en CMMNTY. Een programma dat al bestaat
// (zelfde program.id) wordt niet opnieuw ingeladen of geactiveerd: wat je in de app aanpast blijft.
async function main() {
  const email = (process.env.SEED_EMAIL ?? "ik@luzex.local").toLowerCase();
  const wachtwoord = process.env.SEED_WACHTWOORD ?? "wijzig-dit-meteen";
  const naam = process.env.SEED_NAAM ?? "Ik";

  if (await prisma.gebruiker.findUnique({ where: { email } })) {
    console.log(`Account bestaat al: ${email}`);
  } else {
    await prisma.gebruiker.create({ data: { email, naam, wachtwoordHash: await hashWachtwoord(wachtwoord) } });
    console.log(`Account aangemaakt: ${email}`);
    if (!process.env.SEED_WACHTWOORD) {
      console.log(`Standaardwachtwoord "${wachtwoord}" — alleen voor lokale ontwikkeling.`);
    }
  }

  const validatie = valideerProgramma(JSON.parse(await readFile(STANDAARD_PROGRAMMA, "utf8")));
  if (!validatie.ok) throw new Error(`Meegeleverd programma klopt niet: ${validatie.fouten.join("; ")}`);
  const sleutel = validatie.bestand.program.id;
  if (await prisma.programma.findUnique({ where: { sleutel } })) {
    console.log(`Programma ${sleutel} bestaat al; niets aangepast.`);
    return;
  }
  await importeerProgramma(prisma, validatie.bestand, { activeren: true });
  console.log(`Programma "${validatie.bestand.program.name}" ingeladen en actief gemaakt.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
