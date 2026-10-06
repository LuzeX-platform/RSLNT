import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";
import { actiefProgramma } from "../trainingData.js";
import { ongeldig } from "./auth.js";

const MATERIALEN = ["dumbbell", "barbell", "trap_bar", "kabel", "machine", "lichaamsgewicht", "kettlebell", "band", "overig"] as const;

const oefeningVelden = {
  naam: z.string().trim().min(1, "Naam is verplicht").max(80),
  materiaal: z.enum(MATERIALEN),
  gewichtsstap: z.number().min(0).max(50),
  perKant: z.boolean(),
  knieGevoelig: z.boolean(),
};

const regelSchema = z
  .object({
    oefeningId: z.string().min(1),
    aantalSets: z.number().int().min(1).max(10),
    minSets: z.number().int().min(1).max(10),
    repsMin: z.number().int().min(1).max(100),
    repsMax: z.number().int().min(1).max(100),
    supersetGroep: z.string().trim().max(4).nullable().optional(),
    rustSeconden: z.number().int().min(0).max(900).nullable().optional(),
    doelRir: z.number().int().min(0).max(5).nullable().optional(),
    cue: z.string().trim().max(300).optional(),
  })
  .refine((r) => r.repsMin <= r.repsMax, { message: "Reps: de onderkant is hoger dan de bovenkant", path: ["repsMin"] })
  .refine((r) => r.minSets <= r.aantalSets, { message: "Minimum sets is hoger dan het aantal sets", path: ["minSets"] });

const schemaPutSchema = z.object({
  naam: z.string().trim().min(1).max(40).optional(),
  oefeningen: z.array(regelSchema).max(20),
});

/** "Leg press (smal)" → leg_press_smal; bij een botsing komt er een volgnummer achter. */
export async function nieuweSleutel(gebruikerId: string, naam: string): Promise<string> {
  const basis = naam.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "oefening";
  let sleutel = basis;
  for (let i = 2; await prisma.oefening.findUnique({ where: { gebruikerId_sleutel: { gebruikerId, sleutel } } }); i++) {
    sleutel = `${basis}_${i}`;
  }
  return sleutel;
}

export async function schemaRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);

  app.get("/api/oefeningen", async (request) => {
    const oefeningen = await prisma.oefening.findMany({ where: { gebruikerId: gid(request) }, orderBy: { naam: "asc" } });
    return { oefeningen };
  });

  app.post("/api/oefeningen", async (request, reply) => {
    const parsed = z.object(oefeningVelden).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const g = gid(request);
    if (await prisma.oefening.findUnique({ where: { gebruikerId_naam: { gebruikerId: g, naam: parsed.data.naam } } })) {
      return reply.code(409).send({ errorCode: "OEFENING_BESTAAT_AL" });
    }
    const oefening = await prisma.oefening.create({
      data: { gebruikerId: g, sleutel: await nieuweSleutel(g, parsed.data.naam), ...parsed.data },
    });
    return { oefening };
  });

  app.patch<{ Params: { id: string } }>("/api/oefeningen/:id", async (request, reply) => {
    const parsed = z.object(oefeningVelden).partial().safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const g = gid(request);
    const bestaand = await prisma.oefening.findFirst({ where: { id: request.params.id, gebruikerId: g } });
    if (!bestaand) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    if (parsed.data.naam && parsed.data.naam !== bestaand.naam) {
      if (await prisma.oefening.findUnique({ where: { gebruikerId_naam: { gebruikerId: g, naam: parsed.data.naam } } })) {
        return reply.code(409).send({ errorCode: "OEFENING_BESTAAT_AL" });
      }
    }
    const oefening = await prisma.oefening.update({ where: { id: bestaand.id }, data: parsed.data });
    return { oefening };
  });

  // De trainingen (A, B, C …) van het actieve programma.
  app.get("/api/schemas", async (request) => {
    const programma = await actiefProgramma(gid(request));
    if (!programma) return { programma: null, schemas: [] };
    const schemas = await prisma.schema.findMany({
      where: { programmaId: programma.id, inRotatie: true },
      orderBy: { volgorde: "asc" },
      include: { oefeningen: { orderBy: { volgorde: "asc" }, include: { oefening: true } } },
    });
    return { programma: { id: programma.id, naam: programma.naam }, schemas };
  });

  // Vervangt de hele lijst in één keer (zelfde patroon als de tarievenlijst in ACCRD): de
  // volgorde is de volgorde in de array. Geschiedenis blijft intact, want trainingen bewaren
  // hun eigen momentopname van het schema.
  app.put<{ Params: { id: string } }>("/api/schemas/:id", async (request, reply) => {
    const parsed = schemaPutSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const g = gid(request);
    const schema = await prisma.schema.findFirst({ where: { id: request.params.id, programma: { gebruikerId: g } } });
    if (!schema) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });

    const ids = [...new Set(parsed.data.oefeningen.map((r) => r.oefeningId))];
    if (ids.length !== parsed.data.oefeningen.length) {
      return reply.code(400).send({ errorCode: "DUBBELE_OEFENING", bericht: "Een oefening staat twee keer in dit schema." });
    }
    // Alleen je eigen oefeningen.
    if ((await prisma.oefening.count({ where: { gebruikerId: g, id: { in: ids } } })) !== ids.length) {
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
              rustSeconden: r.rustSeconden ?? null,
              doelRir: r.doelRir ?? null,
              cue: r.cue ?? "",
            })),
          },
        },
      }),
    ]);
    return { ok: true };
  });
}
