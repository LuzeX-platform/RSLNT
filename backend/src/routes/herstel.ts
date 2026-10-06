import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { requireIngelogd } from "../plugins/requireAuth.js";
import { isDag, naarDatum, uitDatum, vandaag, verschuifDag } from "../datum.js";
import { deloadOverwegen, herstelSignalen, type HerstelWaarden } from "../herstel.js";
import { ongeldig } from "./auth.js";

const schaal = z.number().int().min(1).max(5);
const checkSchema = z.object({ slaap: schaal, spierpijn: schaal, energie: schaal, kniepijn: schaal });

const waarden = (c: HerstelWaarden): HerstelWaarden => ({
  slaap: c.slaap,
  energie: c.energie,
  spierpijn: c.spierpijn,
  kniepijn: c.kniepijn,
});

/** De check van vandaag met signalen, voor het beginscherm. */
export async function herstelVandaag(dag = vandaag()) {
  const checks = await prisma.herstelcheck.findMany({
    where: { datum: { lte: naarDatum(dag), gte: naarDatum(verschuifDag(dag, -60)) } },
    orderBy: { datum: "desc" },
    take: 30,
  });
  const vandaagCheck = checks[0] && uitDatum(checks[0].datum) === dag ? checks[0] : null;
  const eerder = (vandaagCheck ? checks.slice(1) : checks).map(waarden);
  return {
    check: vandaagCheck && { datum: dag, ...waarden(vandaagCheck) },
    signalen: vandaagCheck ? herstelSignalen(waarden(vandaagCheck), eerder) : null,
    deloadOverwegen: deloadOverwegen(checks.map(waarden)),
  };
}

export async function herstelRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);

  app.put<{ Params: { datum: string } }>("/api/herstel/:datum", async (request, reply) => {
    const { datum } = request.params;
    if (!isDag(datum) || datum > verschuifDag(vandaag(), 1)) return reply.code(400).send({ errorCode: "ONGELDIGE_DATUM" });
    const parsed = checkSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    await prisma.herstelcheck.upsert({
      where: { datum: naarDatum(datum) },
      update: parsed.data,
      create: { datum: naarDatum(datum), ...parsed.data },
    });
    return herstelVandaag(datum);
  });

  app.get<{ Querystring: { dagen?: string } }>("/api/herstel", async (request) => {
    const dagen = Math.min(Math.max(Number(request.query.dagen) || 28, 7), 365);
    const checks = await prisma.herstelcheck.findMany({
      where: { datum: { gte: naarDatum(verschuifDag(vandaag(), -(dagen - 1))) } },
      orderBy: { datum: "desc" },
    });
    return { checks: checks.map((c) => ({ datum: uitDatum(c.datum), ...waarden(c) })) };
  });
}
