import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";
import { metGemiddelde, zevenDaagsGemiddelde } from "../gewicht.js";
import { isDag, naarDatum, uitDatum, vandaag, verschuifDag } from "../datum.js";
import { ongeldig } from "./auth.js";

const gewichtSchema = z.object({ gewicht: z.number().min(30).max(300) });

export async function lichaamsgewichtRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);

  app.get<{ Querystring: { dagen?: string } }>("/api/lichaamsgewicht", async (request) => {
    const dagen = Math.min(Math.max(Number(request.query.dagen) || 90, 7), 3650);
    const dag = vandaag();
    const vanaf = verschuifDag(dag, -(dagen - 1));
    // Zes dagen extra ophalen, zodat ook de oudste getoonde dag een volledig 7-daags gemiddelde heeft.
    const rijen = await prisma.lichaamsgewicht.findMany({
      where: { gebruikerId: gid(request), datum: { gte: naarDatum(verschuifDag(vanaf, -6)) } },
      orderBy: { datum: "desc" },
    });
    const metingen = rijen.map((r) => ({ datum: uitDatum(r.datum), gewicht: r.gewicht }));
    return {
      vandaag: dag,
      gemiddelde7: zevenDaagsGemiddelde(metingen, dag),
      metingen: metGemiddelde(metingen).filter((m) => m.datum >= vanaf),
    };
  });

  app.put<{ Params: { datum: string } }>("/api/lichaamsgewicht/:datum", async (request, reply) => {
    const { datum } = request.params;
    // Een dag speling naar voren: de telefoon kan net over middernacht zijn terwijl de server niet.
    if (!isDag(datum) || datum > verschuifDag(vandaag(), 1)) {
      return reply.code(400).send({ errorCode: "ONGELDIGE_DATUM" });
    }
    const parsed = gewichtSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const g = gid(request);
    await prisma.lichaamsgewicht.upsert({
      where: { gebruikerId_datum: { gebruikerId: g, datum: naarDatum(datum) } },
      update: { gewicht: parsed.data.gewicht },
      create: { gebruikerId: g, datum: naarDatum(datum), gewicht: parsed.data.gewicht },
    });
    return { ok: true };
  });

  app.delete<{ Params: { datum: string } }>("/api/lichaamsgewicht/:datum", async (request, reply) => {
    if (!isDag(request.params.datum)) return reply.code(400).send({ errorCode: "ONGELDIGE_DATUM" });
    await prisma.lichaamsgewicht.deleteMany({ where: { gebruikerId: gid(request), datum: naarDatum(request.params.datum) } });
    return { ok: true };
  });
}
