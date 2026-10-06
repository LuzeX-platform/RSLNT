import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireIngelogd } from "../plugins/requireAuth.js";
import { trainingDetail, volgendeSchema } from "../trainingData.js";
import { zevenDaagsGemiddelde } from "../gewicht.js";
import { naarDatum, uitDatum, vandaag, verschuifDag } from "../datum.js";
import { ongeldig } from "./auth.js";

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
    const [bezig, recent, laatsteWeging, metingen, volgende, schemas] = await Promise.all([
      prisma.training.findFirst({
        where: { status: "bezig" },
        orderBy: { datum: "desc" },
        include: { schema: { select: { naam: true } } },
      }),
      prisma.training.findMany({
        orderBy: { datum: "desc" },
        take: 8,
        include: {
          schema: { select: { naam: true } },
          oefeningen: { select: { _count: { select: { sets: true } } } },
        },
      }),
      prisma.lichaamsgewicht.findFirst({ orderBy: { datum: "desc" } }),
      prisma.lichaamsgewicht.findMany({ where: { datum: { gte: naarDatum(verschuifDag(dag, -6)) } } }),
      volgendeSchema(),
      prisma.schema.findMany({ orderBy: { volgorde: "asc" }, select: { id: true, naam: true } }),
    ]);

    return {
      bezig: bezig && { id: bezig.id, schemaId: bezig.schemaId, schemaNaam: bezig.schema.naam, datum: bezig.datum },
      volgendeSchema: volgende,
      schemas,
      recent: recent.map((t) => ({
        id: t.id,
        schemaId: t.schemaId,
        schemaNaam: t.schema.naam,
        datum: t.datum,
        status: t.status,
        aantalSets: t.oefeningen.reduce((som, o) => som + o._count.sets, 0),
      })),
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
        schema: { select: { naam: true } },
        oefeningen: { select: { _count: { select: { sets: true } } } },
      },
    });
    return {
      trainingen: trainingen.map((t) => ({
        id: t.id,
        schemaId: t.schemaId,
        schemaNaam: t.schema.naam,
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
      include: { oefeningen: { orderBy: { volgorde: "asc" } } },
    });
    if (!schema) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    if (schema.oefeningen.length === 0) return reply.code(400).send({ errorCode: "SCHEMA_LEEG" });

    const training = await prisma.training.create({
      data: {
        schemaId: schema.id,
        oefeningen: {
          create: schema.oefeningen.map((r) => ({
            oefeningId: r.oefeningId,
            volgorde: r.volgorde,
            aantalSets: r.aantalSets,
            minSets: r.minSets,
            repsMin: r.repsMin,
            repsMax: r.repsMax,
            supersetGroep: r.supersetGroep,
          })),
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
