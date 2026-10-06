// Bouwt data/bibliotheek.json uit dist/exercises.json van Free Exercise DB. Draai dit alleen als
// je de bron bijwerkt (en zet dan ook BRON_COMMIT in bibliotheekOmzetten.ts goed):
//   curl -o /tmp/fedb.json https://raw.githubusercontent.com/yuhonas/free-exercise-db/<commit>/dist/exercises.json
//   npm run bibliotheek -- /tmp/fedb.json

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRON_COMMIT, omzetten, type BronOefening } from "./bibliotheekOmzetten.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOEL = path.join(__dirname, "..", "data", "bibliotheek.json");

async function main() {
  const bron = process.argv[2];
  if (!bron) throw new Error("Gebruik: npm run bibliotheek -- <pad naar exercises.json>");
  const lijst = JSON.parse(await readFile(bron, "utf8")) as BronOefening[];
  const oefeningen = lijst.map(omzetten).sort((a, b) => a.naam.localeCompare(b.naam, "en"));
  const ids = new Set(oefeningen.map((o) => o.id));
  if (ids.size !== oefeningen.length) throw new Error("Dubbele id's in de bron.");
  const bestand = {
    bron: "Free Exercise DB",
    url: "https://github.com/yuhonas/free-exercise-db",
    commit: BRON_COMMIT,
    licentie: "Unlicense (publiek domein)",
    oefeningen,
  };
  // Eén oefening per regel: kleine diffs als de bron verandert.
  const regels = oefeningen.map((o) => JSON.stringify(o));
  const kop = JSON.stringify({ ...bestand, oefeningen: [] }).slice(0, -3);
  await writeFile(DOEL, `${kop}[\n${regels.join(",\n")}\n]}\n`);
  console.log(`${oefeningen.length} oefeningen geschreven naar ${path.relative(process.cwd(), DOEL)}`);
}

main().catch((fout) => {
  console.error(fout);
  process.exit(1);
});
