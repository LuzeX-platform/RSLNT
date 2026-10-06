import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";
import { activeer, ImportFout, importeerProgramma, valideerProgramma } from "../programmaImport.js";
import { naarDatum, vandaag, verschuifDag } from "../datum.js";
import { ongeldig } from "./auth.js";

export async function programmaRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);

  app.get("/api/programmas", async (request) => {
    const programmas = await prisma.programma.findMany({
      where: { gebruikerId: gid(request) },
      orderBy: [{ actief: "desc" }, { aangemaaktOp: "desc" }],
      include: { schemas: { where: { inRotatie: true }, orderBy: { volgorde: "asc" }, select: { code: true, naam: true } } },
    });
    return {
      programmas: programmas.map((p) => ({
        id: p.id,
        sleutel: p.sleutel,
        naam: p.naam,
        actief: p.actief,
        startdatum: p.startdatum,
        heeftBron: p.bron !== null,
        schemas: p.schemas,
      })),
    };
  });

  // Een programma-JSON inladen. Met ?controle=1 alleen controleren, niets opslaan.
  app.post<{ Querystring: { controle?: string } }>("/api/programmas/import", { bodyLimit: 1024 * 1024 }, async (request, reply) => {
    const parsed = z.object({ bestand: z.unknown(), activeren: z.boolean().default(true) }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const validatie = valideerProgramma(parsed.data.bestand);
    if (!validatie.ok) {
      return reply.code(400).send({ errorCode: "ONGELDIG_PROGRAMMA", fouten: validatie.fouten, bericht: validatie.fouten[0] });
    }
    if (request.query.controle) return { ok: true, waarschuwingen: validatie.waarschuwingen };
    try {
      const { id, nieuw } = await importeerProgramma(prisma, validatie.bestand, { activeren: parsed.data.activeren, gebruikerId: gid(request) });
      return { id, nieuw, waarschuwingen: validatie.waarschuwingen };
    } catch (fout) {
      if (fout instanceof ImportFout) return reply.code(409).send({ errorCode: "IMPORT_CONFLICT", bericht: fout.message });
      throw fout;
    }
  });

  app.post<{ Params: { id: string } }>("/api/programmas/:id/activeren", async (request, reply) => {
    const bestaat = await prisma.programma.findFirst({ where: { id: request.params.id, gebruikerId: gid(request) }, select: { id: true } });
    if (!bestaat) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    await prisma.$transaction((tx) => activeer(tx, bestaat.id));
    return { ok: true };
  });

  // "Nu deloaden": de komende 7 dagen (vandaag meegeteld) zijn deload. aan: false zet het terug.
  app.post<{ Params: { id: string } }>("/api/programmas/:id/deload", async (request, reply) => {
    const parsed = z.object({ aan: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const { count } = await prisma.programma.updateMany({
      where: { id: request.params.id, gebruikerId: gid(request) },
      data: { deloadTot: parsed.data.aan ? naarDatum(verschuifDag(vandaag(), 6)) : null },
    });
    if (count === 0) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    return { ok: true };
  });

  // Het oorspronkelijke bestand terug, om te bewaren of verder te bewerken.
  app.get<{ Params: { id: string } }>("/api/programmas/:id/bestand", async (request, reply) => {
    const programma = await prisma.programma.findFirst({ where: { id: request.params.id, gebruikerId: gid(request) } });
    if (!programma?.bron) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    reply.header("Content-Disposition", `attachment; filename="${programma.sleutel}.json"`);
    return programma.bron;
  });
}
