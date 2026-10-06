import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireIngelogd } from "../plugins/requireAuth.js";
import { actiefProgramma, faseInstellingen, faseVoor, trainingDetail, volgendeSchema } from "../trainingData.js";
import { doelInFase } from "../fase.js";
import { zevenDaagsGemiddelde } from "../gewicht.js";
import { naarDatum, uitDatum, vandaag, verschuifDag } from "../datum.js";
import { ongeldig } from "./auth.js";
import { herstelVandaag } from "./herstel.js";

const setSchema = z.object({
  gewicht: z.number().min(0).max(1000).nullable(),
  reps: z.number().int().min(0).max(100),
  rir: z.number().int().min(0).max(4).nullable(),
  kniepijn: z.number().int().min(0).max(10).nullable(),
});

const setParams = z.object({
  id: z.string().min(1),
  toId: z.string().min(1),
  nummer: z.coerce.number().int().min(1).max(20),
});

type SetParams = { id: string; toId: string; nummer: string };

export async function trainingRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);

  // Alles voor het beginscherm in één verzoek: in de sportschool telt elke round-trip.
  app.get("/api/vandaag", async () => {
    const dag = vandaag();
    const [programma, bezig, recent, laatsteWeging, metingen] = await Promise.all([
      actiefProgramma(),
      prisma.training.findFirst({
        where: { status: "bezig" },
        orderBy: { datum: "desc" },
        include: { schema: { select: { code: true, naam: true } } },
      }),
      prisma.training.findMany({
        orderBy: { datum: "desc" },
        take: 8,
        include: {
          schema: { select: { code: true, naam: true } },
          oefeningen: { select: { _count: { select: { sets: true } } } },
        },
      }),
      prisma.lichaamsgewicht.findFirst({ orderBy: { datum: "desc" } }),
      prisma.lichaamsgewicht.findMany({ where: { datum: { gte: naarDatum(verschuifDag(dag, -6)) } } }),
    ]);

    const [volgende, herstel] = await Promise.all([programma ? volgendeSchema(programma) : null, herstelVandaag(dag)]);
    const fase = programma ? faseVoor(programma, dag) : null;
    const laatsteDag = recent[0] ? recent[0].datum.toLocaleDateString("en-CA", { timeZone: "Europe/Amsterdam" }) : null;
    // Rustdagen tussen de vorige training en vandaag; het programma adviseert er minstens zoveel.
    const rustdagen = laatsteDag ? Math.round((naarDatum(dag).getTime() - naarDatum(laatsteDag).getTime()) / 86400000) - 1 : null;

    return {
      programma: programma && {
        id: programma.id,
        naam: programma.naam,
        opwarmen: programma.opwarmen,
        introWeken: programma.introWeken,
        introSets: programma.introSets,
        introRir: programma.introRir,
        deloadElkeWeken: programma.deloadElkeWeken,
        minRustdagen: programma.minRustdagen,
        fase,
        rustAdvies: rustdagen !== null && rustdagen >= 0 && rustdagen < programma.minRustdagen && !bezig,
      },
      bezig: bezig && {
        id: bezig.id,
        schemaId: bezig.schemaId,
        schemaCode: bezig.schema.code,
        schemaNaam: bezig.schema.naam,
        datum: bezig.datum,
      },
      volgendeSchema: volgende && { id: volgende.id, code: volgende.code, naam: volgende.naam, minuten: volgende.minuten },
      schemas: (programma?.schemas ?? []).map((s) => ({ id: s.id, code: s.code, naam: s.naam })),
      recent: recent.map((t) => ({
        id: t.id,
        schemaId: t.schemaId,
        schemaCode: t.schema.code,
        schemaNaam: t.schema.naam,
        datum: t.datum,
        status: t.status,
        fase: t.fase,
        aantalSets: t.oefeningen.reduce((som, o) => som + o._count.sets, 0),
      })),
      herstel,
      gewicht: {
        laatste: laatsteWeging && { datum: uitDatum(laatsteWeging.datum), gewicht: laatsteWeging.gewicht },
        gemiddelde7: zevenDaagsGemiddelde(
          metingen.map((m) => ({ datum: uitDatum(m.datum), gewicht: m.gewicht })),
          dag,
        ),
        vandaag: dag,
      },
    };
  });

  app.get<{ Querystring: { limiet?: string } }>("/api/trainingen", async (request) => {
    const limiet = Math.min(Math.max(Number(request.query.limiet) || 30, 1), 200);
    const trainingen = await prisma.training.findMany({
      orderBy: { datum: "desc" },
      take: limiet,
      include: {
        schema: { select: { code: true, naam: true } },
        oefeningen: { select: { _count: { select: { sets: true } } } },
      },
    });
    return {
      trainingen: trainingen.map((t) => ({
        id: t.id,
        schemaId: t.schemaId,
        schemaCode: t.schema.code,
        schemaNaam: t.schema.naam,
        fase: t.fase,
        datum: t.datum,
        status: t.status,
        aantalSets: t.oefeningen.reduce((som, o) => som + o._count.sets, 0),
      })),
    };
  });

  app.post("/api/trainingen", async (request, reply) => {
    const parsed = z.object({ schemaId: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);

    // Eén training tegelijk: een tweede start is bijna altijd een dubbele tik.
    const bezig = await prisma.training.findFirst({ where: { status: "bezig" }, select: { id: true } });
    if (bezig) return reply.code(409).send({ errorCode: "TRAINING_BEZIG", id: bezig.id });

    const schema = await prisma.schema.findUnique({
      where: { id: parsed.data.schemaId },
      include: { programma: true, oefeningen: { orderBy: { volgorde: "asc" } } },
    });
    if (!schema) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    if (schema.oefeningen.length === 0) return reply.code(400).send({ errorCode: "SCHEMA_LEEG" });

    // De fase (intro/deload) wordt bij het starten vastgelegd, met het aangepaste doel per oefening.
    const fase = faseVoor(schema.programma, vandaag());
    const instellingen = faseInstellingen(schema.programma);
    const training = await prisma.training.create({
      data: {
        schemaId: schema.id,
        fase: fase.fase,
        week: fase.week,
        oefeningen: {
          create: schema.oefeningen.map((r) => {
            const doel = doelInFase({ aantalSets: r.aantalSets, minSets: r.minSets, doelRir: r.doelRir }, fase.fase, instellingen);
            return {
              oefeningId: r.oefeningId,
              volgorde: r.volgorde,
              aantalSets: doel.aantalSets,
              minSets: doel.minSets,
              doelRir: doel.doelRir,
              repsMin: r.repsMin,
              repsMax: r.repsMax,
              supersetGroep: r.supersetGroep,
              rustSeconden: r.rustSeconden,
              cue: r.cue,
            };
          }),
        },
      },
    });
    return { id: training.id };
  });

  app.get<{ Params: { id: string } }>("/api/trainingen/:id", async (request, reply) => {
    const detail = await trainingDetail(request.params.id);
    if (!detail) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    return detail;
  });

  app.patch<{ Params: { id: string } }>("/api/trainingen/:id", async (request, reply) => {
    const parsed = z.object({ notitie: z.string().max(4000) }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const { count } = await prisma.training.updateMany({
      where: { id: request.params.id },
      data: { notitie: parsed.data.notitie },
    });
    if (count === 0) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    return { ok: true };
  });

  // Idempotent: de offline-wachtrij kan dit twee keer sturen.
  app.post<{ Params: { id: string } }>("/api/trainingen/:id/afronden", async (request, reply) => {
    const training = await prisma.training.findUnique({ where: { id: request.params.id } });
    if (!training) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    if (training.status !== "afgerond") {
      await prisma.training.update({
        where: { id: training.id },
        data: { status: "afgerond", afgerondOp: new Date() },
      });
    }
    return trainingDetail(training.id);
  });

  app.post<{ Params: { id: string } }>("/api/trainingen/:id/heropenen", async (request, reply) => {
    const bezig = await prisma.training.findFirst({
      where: { status: "bezig", id: { not: request.params.id } },
      select: { id: true },
    });
    if (bezig) return reply.code(409).send({ errorCode: "TRAINING_BEZIG", id: bezig.id });
    const { count } = await prisma.training.updateMany({
      where: { id: request.params.id },
      data: { status: "bezig", afgerondOp: null },
    });
    if (count === 0) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>("/api/trainingen/:id", async (request, reply) => {
    const { count } = await prisma.training.deleteMany({ where: { id: request.params.id } });
    if (count === 0) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    return { ok: true };
  });

  // Een oefening voor deze ene training wisselen (machine bezet, knie zeurt), alleen voor een
  // alternatief uit het programma. oefeningId null = terug naar de oefening uit het schema.
  app.patch<{ Params: { id: string; toId: string } }>(
    "/api/trainingen/:id/oefeningen/:toId/wissel",
    async (request, reply) => {
      const parsed = z.object({ oefeningId: z.string().min(1).nullable() }).safeParse(request.body);
      if (!parsed.success) return ongeldig(reply, parsed.error);
      const regel = await prisma.trainingOefening.findFirst({
        where: { id: request.params.toId, trainingId: request.params.id },
        include: { _count: { select: { sets: true } } },
      });
      if (!regel) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
      if (regel._count.sets > 0) return reply.code(409).send({ errorCode: "AL_SETS_GELOGD" });

      const origineelId = regel.origineleOefeningId ?? regel.oefeningId;
      const doelId = parsed.data.oefeningId ?? origineelId;
      if (doelId === origineelId) {
        await prisma.trainingOefening.update({
          where: { id: regel.id },
          data: { oefeningId: origineelId, origineleOefeningId: null },
        });
        return trainingDetail(request.params.id);
      }
      const [origineel, doel] = await Promise.all([
        prisma.oefening.findUnique({ where: { id: origineelId } }),
        prisma.oefening.findUnique({ where: { id: doelId } }),
      ]);
      if (!origineel || !doel || !origineel.alternatieven.includes(doel.sleutel)) {
        return reply.code(400).send({ errorCode: "GEEN_ALTERNATIEF" });
      }
      const alInTraining = await prisma.trainingOefening.findFirst({
        where: { trainingId: request.params.id, oefeningId: doel.id, NOT: { id: regel.id } },
      });
      if (alInTraining) return reply.code(409).send({ errorCode: "AL_IN_TRAINING" });
      await prisma.trainingOefening.update({
        where: { id: regel.id },
        data: { oefeningId: doel.id, origineleOefeningId: origineelId },
      });
      return trainingDetail(request.params.id);
    },
  );

  // Een set opslaan of overschrijven. PUT op een vaste plek (training/oefening/setnummer), zodat
  // dezelfde set twee keer versturen (offline-wachtrij, dubbele tik) nooit twee sets oplevert.
  app.put<{ Params: SetParams }>("/api/trainingen/:id/oefeningen/:toId/sets/:nummer", async (request, reply) => {
    const params = setParams.safeParse(request.params);
    if (!params.success) return ongeldig(reply, params.error);
    const parsed = setSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const { id, toId, nummer } = params.data;

    const regel = await prisma.trainingOefening.findFirst({ where: { id: toId, trainingId: id }, select: { id: true } });
    if (!regel) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });

    const set = await prisma.trainingSet.upsert({
      where: { trainingOefeningId_nummer: { trainingOefeningId: regel.id, nummer } },
      update: parsed.data,
      create: { trainingOefeningId: regel.id, nummer, ...parsed.data },
      select: { nummer: true, gewicht: true, reps: true, rir: true, kniepijn: true },
    });
    return { set };
  });

  app.delete<{ Params: SetParams }>("/api/trainingen/:id/oefeningen/:toId/sets/:nummer", async (request, reply) => {
    const params = setParams.safeParse(request.params);
    if (!params.success) return ongeldig(reply, params.error);
    const { id, toId, nummer } = params.data;
    const regel = await prisma.trainingOefening.findFirst({ where: { id: toId, trainingId: id }, select: { id: true } });
    if (!regel) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    await prisma.trainingSet.deleteMany({ where: { trainingOefeningId: regel.id, nummer } });
    return { ok: true };
  });
}
