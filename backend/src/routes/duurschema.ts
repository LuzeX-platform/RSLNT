// Het duursportschema (gratis): kiezen, bekijken, je dagen, en een sessie afvinken. Een afgevinkte
// sessie wordt een gewone duurtraining (zelfde tabel als Hybride trainen bij Pro).

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";
import { isDag, naarDatum, vandaag, verschuifDag } from "../datum.js";
import {
  AFSTANDEN,
  controleer,
  DUUR_DOELEN,
  DUUR_NIVEAUS,
  DUUR_SPORTEN,
  DuurFout,
  maakDuurschema,
  NIVEAU_UITLEG,
  standaardDuurdagen,
  type DuurInstellingen,
} from "../duurschema.js";
import { duurDezeWeek, duurSessies, instellingenVan, krachtDagen } from "../duurData.js";
import { maandagVan, TIJD, WEEKDAGEN } from "../planning.js";
import { ongeldig } from "./auth.js";

const instellingenSchema = z.object({
  sport: z.enum(Object.keys(DUUR_SPORTEN) as [keyof typeof DUUR_SPORTEN]),
  doel: z.enum(Object.keys(DUUR_DOELEN) as [keyof typeof DUUR_DOELEN]),
  afstand: z.number().positive().nullable().default(null),
  niveau: z.enum(Object.keys(DUUR_NIVEAUS) as [keyof typeof DUUR_NIVEAUS]),
  dagenPerWeek: z.number().int().min(2).max(4),
});
const dagenSchema = z.array(z.number().int().min(1).max(7)).min(2).max(4);

function geldig(i: z.infer<typeof instellingenSchema>): DuurInstellingen {
  const instellingen: DuurInstellingen = { ...i, afstand: i.doel === "afstand" ? i.afstand : null };
  controleer(instellingen);
  return instellingen;
}

export async function duurschemaRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);

  const fout = (reply: { code: (n: number) => { send: (b: unknown) => unknown } }, f: unknown) => {
    if (f instanceof DuurFout) return reply.code(400).send({ errorCode: "ONGELDIG_DUURSCHEMA", bericht: f.message });
    throw f;
  };

  app.get("/api/duurschema", async (request) => {
    const g = gid(request);
    const dag = vandaag();
    const [week, kracht] = await Promise.all([duurDezeWeek(g, dag), krachtDagen(g)]);
    const keuzes = { sporten: DUUR_SPORTEN, doelen: DUUR_DOELEN, niveaus: DUUR_NIVEAUS, niveauUitleg: NIVEAU_UITLEG, afstanden: AFSTANDEN, weekdagen: WEEKDAGEN };
    if (!week) return { keuzes, kracht, schema: null };
    const schema = maakDuurschema(instellingenVan(week.rij));
    return {
      keuzes,
      kracht,
      instellingen: { ...instellingenVan(week.rij), dagen: week.rij.dagen, tijd: week.rij.tijd },
      schema,
      week: week.sessies[0]?.week ?? null,
      dezeWeek: week.sessies,
      vandaag: dag,
    };
  });

  // Een voorbeeld, zonder iets op te slaan.
  app.post("/api/duurschema/voorstel", async (request, reply) => {
    const parsed = instellingenSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    try {
      const i = geldig(parsed.data);
      const kracht = await krachtDagen(gid(request));
      return { schema: maakDuurschema(i), dagen: standaardDuurdagen(i.dagenPerWeek, kracht.alle) };
    } catch (f) {
      return fout(reply, f);
    }
  });

  app.put("/api/duurschema", async (request, reply) => {
    const parsed = instellingenSchema.extend({ dagen: dagenSchema.optional(), tijd: z.string().regex(TIJD).optional() }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const { dagen, tijd, ...rest } = parsed.data;
    let i: DuurInstellingen;
    try {
      i = geldig(rest);
    } catch (f) {
      return fout(reply, f);
    }
    const g = gid(request);
    const gekozen = dagen ? [...new Set(dagen)].sort((a, b) => a - b) : standaardDuurdagen(i.dagenPerWeek, (await krachtDagen(g)).alle);
    if (gekozen.length !== i.dagenPerWeek) return reply.code(400).send({ errorCode: "ONGELDIG_DUURSCHEMA", bericht: `Kies ${i.dagenPerWeek} dagen.` });
    const data = { ...i, dagen: gekozen, ...(tijd ? { tijd } : {}), startdatum: naarDatum(maandagVan(vandaag())) };
    await prisma.duurschema.upsert({ where: { gebruikerId: g }, update: data, create: { gebruikerId: g, ...data } });
    return { ok: true };
  });

  // Alleen je dagen of tijd wijzigen; het schema loopt door.
  app.put("/api/duurschema/dagen", async (request, reply) => {
    const parsed = z.object({ dagen: dagenSchema, tijd: z.string().regex(TIJD).optional() }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const g = gid(request);
    const rij = await prisma.duurschema.findUnique({ where: { gebruikerId: g } });
    if (!rij) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    const dagen = [...new Set(parsed.data.dagen)].sort((a, b) => a - b);
    if (dagen.length !== rij.dagenPerWeek) return reply.code(400).send({ errorCode: "ONGELDIG_DUURSCHEMA", bericht: `Kies ${rij.dagenPerWeek} dagen.` });
    await prisma.duurschema.update({ where: { gebruikerId: g }, data: { dagen, ...(parsed.data.tijd ? { tijd: parsed.data.tijd } : {}) } });
    return { ok: true };
  });

  app.delete("/api/duurschema", async (request) => {
    await prisma.duurschema.deleteMany({ where: { gebruikerId: gid(request) } });
    return { ok: true };
  });

  // Afvinken: de geplande sessie van die dag wordt een duurtraining. Twee keer tikken maakt er geen twee.
  app.post("/api/duurschema/gedaan", async (request, reply) => {
    const parsed = z.object({ datum: z.string().refine(isDag, "Ongeldige datum") }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const { datum } = parsed.data;
    const dag = vandaag();
    if (datum > dag || datum < verschuifDag(dag, -14)) return reply.code(400).send({ errorCode: "ONGELDIGE_DATUM" });
    const g = gid(request);
    const rij = await prisma.duurschema.findUnique({ where: { gebruikerId: g } });
    if (!rij) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    const { benen } = await krachtDagen(g);
    const gepland = duurSessies(rij, maandagVan(datum), 1, benen).find((d) => d.datum === datum);
    if (!gepland) return reply.code(404).send({ errorCode: "NIET_GEPLAND", bericht: "Op die dag staat geen duurtraining." });
    const bestaand = await prisma.duurtraining.findFirst({ where: { gebruikerId: g, datum: naarDatum(datum), soort: gepland.sessie.sport } });
    if (!bestaand) {
      await prisma.duurtraining.create({
        data: {
          gebruikerId: g,
          datum: naarDatum(datum),
          soort: gepland.sessie.sport,
          minuten: gepland.sessie.minuten,
          afstandMeter: gepland.sessie.meters,
          intensiteit: gepland.sessie.intensiteit,
          notitie: `${gepland.sessie.titel} (week ${gepland.week} van je duurschema)`,
        },
      });
    }
    return { ok: true };
  });
}
