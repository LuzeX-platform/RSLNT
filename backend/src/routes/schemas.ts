import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireIngelogd } from "../plugins/requireAuth.js";
import { ongeldig } from "./auth.js";

const MATERIALEN = ["dumbbell", "barbell", "kabel", "machine", "lichaamsgewicht"] as const;

const oefeningVelden = {
  naam: z.string().trim().min(1, "Naam is verplicht").max(80),
  materiaal: z.enum(MATERIALEN),
  gewichtsstap: z.number().min(0).max(50),
  perKant: z.boolean(),
};

const regelSchema = z
  .object({
    oefeningId: z.string().min(1),
    aantalSets: z.number().int().min(1).max(10),
    minSets: z.number().int().min(1).max(10),
    repsMin: z.number().int().min(1).max(100),
    repsMax: z.number().int().min(1).max(100),
    supersetGroep: z.string().trim().max(4).nullable().optional(),
  })
  .refine((r) => r.repsMin <= r.repsMax, { message: "Reps: de onderkant is hoger dan de bovenkant", path: ["repsMin"] })
  .refine((r) => r.minSets <= r.aantalSets, { message: "Minimum sets is hoger dan het aantal sets", path: ["minSets"] });

const schemaPutSchema = z.object({
  naam: z.string().trim().min(1).max(40).optional(),
  oefeningen: z.array(regelSchema).max(20),
});

export async function schemaRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);

  app.get("/api/oefeningen", async () => {
    const oefeningen = await prisma.oefening.findMany({ orderBy: { naam: "asc" } });
    return { oefeningen };
  });

  app.post("/api/oefeningen", async (request, reply) => {
    const parsed = z.object(oefeningVelden).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    if (await prisma.oefening.findUnique({ where: { naam: parsed.data.naam } })) {
      return reply.code(409).send({ errorCode: "OEFENING_BESTAAT_AL" });
    }
    const oefening = await prisma.oefening.create({ data: normaliseer(parsed.data) });
    return { oefening };
  });

  app.patch<{ Params: { id: string } }>("/api/oefeningen/:id", async (request, reply) => {
    const parsed = z.object(oefeningVelden).partial().safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const bestaand = await prisma.oefening.findUnique({ where: { id: request.params.id } });
    if (!bestaand) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    if (parsed.data.naam && parsed.data.naam !== bestaand.naam) {
      if (await prisma.oefening.findUnique({ where: { naam: parsed.data.naam } })) {
        return reply.code(409).send({ errorCode: "OEFENING_BESTAAT_AL" });
      }
    }
    const oefening = await prisma.oefening.update({
      where: { id: bestaand.id },
      data: normaliseer({ materiaal: bestaand.materiaal, gewichtsstap: bestaand.gewichtsstap, ...parsed.data }),
    });
    return { oefening };
  });

  app.get("/api/schemas", async () => {
    const schemas = await prisma.schema.findMany({
      orderBy: { volgorde: "asc" },
      include: { oefeningen: { orderBy: { volgorde: "asc" }, include: { oefening: true } } },
    });
    return { schemas };
  });

  // Vervangt de hele lijst in één keer (zelfde patroon als de tarievenlijst in ACCRD): de
  // volgorde is de volgorde in de array. Geschiedenis blijft intact, want trainingen bewaren
  // hun eigen momentopname van het schema.
  app.put<{ Params: { id: string } }>("/api/schemas/:id", async (request, reply) => {
    const parsed = schemaPutSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const schema = await prisma.schema.findUnique({ where: { id: request.params.id } });
    if (!schema) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });

    const ids = [...new Set(parsed.data.oefeningen.map((r) => r.oefeningId))];
    if (ids.length !== parsed.data.oefeningen.length) {
      return reply.code(400).send({ errorCode: "DUBBELE_OEFENING", bericht: "Een oefening staat twee keer in dit schema." });
    }
    if ((await prisma.oefening.count({ where: { id: { in: ids } } })) !== ids.length) {
      return reply.code(400).send({ errorCode: "ONBEKENDE_OEFENING" });
    }

    await prisma.$transaction([
      prisma.schemaOefening.deleteMany({ where: { schemaId: schema.id } }),
      prisma.schema.update({
        where: { id: schema.id },
        data: {
          naam: parsed.data.naam ?? schema.naam,
          oefeningen: {
            create: parsed.data.oefeningen.map((r, i) => ({
              oefeningId: r.oefeningId,
              volgorde: i,
              aantalSets: r.aantalSets,
              minSets: r.minSets,
              repsMin: r.repsMin,
              repsMax: r.repsMax,
              supersetGroep: r.supersetGroep ? r.supersetGroep : null,
            })),
          },
        },
      }),
    ]);
    return { ok: true };
  });
}

/** Lichaamsgewicht heeft geen gewichtsstap; dat houden we op één plek consistent. */
function normaliseer<T extends { materiaal: string; gewichtsstap: number }>(o: T): T {
  return o.materiaal === "lichaamsgewicht" ? { ...o, gewichtsstap: 0 } : o;
}
