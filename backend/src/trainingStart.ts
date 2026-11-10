// Een training starten uit een schema: de momentopname van de oefeningen met het doel van die dag
// (fase, blok, lichte dag). Gebruikt door Start op Vandaag en door Samen trainen.

import { prisma } from "./db.js";
import { alsRegel, faseInstellingen, faseVoor } from "./trainingData.js";
import { doelInBlok } from "./periodisering.js";
import { doelInFase } from "./fase.js";
import { vandaag } from "./datum.js";

export const schemaVoorStart = { programma: true, oefeningen: { orderBy: { volgorde: "asc" as const }, include: { oefening: { select: { mechaniek: true } } } } };

type SchemaMetAlles = NonNullable<Awaited<ReturnType<typeof haalSchema>>>;

function haalSchema(id: string, gebruikerId: string) {
  return prisma.schema.findFirst({ where: { id, programma: { gebruikerId } }, include: schemaVoorStart });
}
export { haalSchema };

/** Maakt de training aan. De aanroeper controleert vooraf: eigen schema, niet leeg, geen andere training bezig. */
export async function maakTraining(gebruikerId: string, schema: SchemaMetAlles, pro: boolean, licht = false): Promise<{ id: string }> {
  // De fase (intro/deload/licht) en het blok (Pro) worden bij het starten vastgelegd, met het
  // aangepaste doel per oefening. Eerst het blok, dan de fase: een deload of lichte dag
  // halveert of verlicht wat het blok voorschrijft. Een lichte dag gaat niet over een intro of
  // deload heen: die zijn al licht.
  const basisFase = faseVoor(schema.programma, vandaag(), pro);
  const fase = licht && basisFase.fase === "normaal" ? { ...basisFase, fase: "licht" as const } : basisFase;
  const blok = fase.blok && fase.blok.soort !== "deload" ? fase.blok.soort : null;
  const instellingen = faseInstellingen(schema.programma);
  return prisma.training.create({
    select: { id: true },
    data: {
      gebruikerId,
      schemaId: schema.id,
      fase: fase.fase,
      week: fase.week,
      blok: fase.blok?.soort ?? null,
      oefeningen: {
        create: schema.oefeningen.map((r) => {
          const inBlok = blok
            ? doelInBlok(r, blok, r.oefening.mechaniek === "compound")
            : { aantalSets: r.aantalSets, minSets: r.minSets, repsMin: r.repsMin, repsMax: r.repsMax, doelRir: r.doelRir };
          const doel = doelInFase(inBlok, fase.fase, instellingen);
          return {
            oefeningId: r.oefeningId,
            volgorde: r.volgorde,
            aantalSets: doel.aantalSets,
            minSets: doel.minSets,
            doelRir: doel.doelRir,
            repsMin: inBlok.repsMin,
            repsMax: inBlok.repsMax,
            supersetGroep: r.supersetGroep,
            rustSeconden: r.rustSeconden,
            cue: r.cue,
            // Zonder Pro geldt de standaardregel en geen techniek, ook als die in het schema
            // staat (bijvoorbeeld van toen je Pro nog had).
            progressie: pro ? alsRegel(r.progressie) : "dubbel",
            techniek: pro ? r.techniek : null,
          };
        }),
      },
    },
  });
}
