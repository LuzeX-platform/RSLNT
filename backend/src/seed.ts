import "dotenv/config";
import { prisma } from "./db.js";
import { hashWachtwoord } from "./auth.js";
import { STANDAARD_OEFENINGEN, STANDAARD_SCHEMAS } from "./standaardSchema.js";

// Maakt jouw account en het startschema aan. Idempotent — draait bij elke opstart (zie
// Dockerfile), zelfde patroon als ACCRD en CMMNTY. Bestaande schema's blijven altijd staan.
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

  if ((await prisma.schema.count()) > 0) {
    console.log("Schema's bestaan al; niets aangepast.");
    return;
  }

  // In één transactie: een halve seed (A wel, B niet) zou bij de volgende start als "bestaat al" gelden.
  await prisma.$transaction(async (tx) => {
    const ids = new Map<string, string>();
    for (const o of STANDAARD_OEFENINGEN) {
      const oefening = await tx.oefening.upsert({
        where: { naam: o.naam },
        update: {},
        create: { naam: o.naam, materiaal: o.materiaal, gewichtsstap: o.gewichtsstap, perKant: o.perKant ?? false },
      });
      ids.set(o.naam, oefening.id);
    }

    for (const [volgorde, schema] of STANDAARD_SCHEMAS.entries()) {
      await tx.schema.create({
        data: {
          id: schema.id,
          naam: schema.naam,
          volgorde,
          oefeningen: {
            create: schema.regels.map((r, i) => ({
              oefeningId: ids.get(r.oefening)!,
              volgorde: i,
              aantalSets: r.aantalSets,
              minSets: r.minSets,
              repsMin: r.repsMin,
              repsMax: r.repsMax,
              supersetGroep: r.supersetGroep ?? null,
            })),
          },
        },
      });
    }
  });
  console.log("Startschema A/B aangemaakt.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
