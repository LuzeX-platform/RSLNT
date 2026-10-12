import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";
import { isDag, naarDatum, uitDatum, vandaag, verschuifDag } from "../datum.js";
import { deloadOverwegen, herstelSignalen, type HerstelWaarden } from "../herstel.js";
import { PIJN_PLEK_SLEUTELS } from "../pijn.js";
import { ongeldig } from "./auth.js";

const schaal = z.number().int().min(1).max(5);
const checkSchema = z
  .object({
    slaap: schaal,
    spierpijn: schaal,
    energie: schaal,
    pijn: schaal.optional(),
    pijnPlekken: z.array(z.enum(PIJN_PLEK_SLEUTELS)).max(PIJN_PLEK_SLEUTELS.length).optional(),
    // Oude app-versie (of de offline-wachtrij van vóór de wijziging): kniepijn = pijn in de knie.
    kniepijn: schaal.optional(),
  })
  .transform(({ kniepijn, pijn, pijnPlekken, ...rest }) => ({
    ...rest,
    pijn: pijn ?? kniepijn,
    pijnPlekken: pijn !== undefined ? [...new Set(pijnPlekken ?? [])] : kniepijn !== undefined && kniepijn >= 2 ? ["knie"] : [],
  }))
  .refine((c): c is typeof c & { pijn: number } => c.pijn !== undefined, { message: "Vul pijntjes in", path: ["pijn"] });

const waarden = (c: HerstelWaarden): HerstelWaarden => ({
  slaap: c.slaap,
  energie: c.energie,
  spierpijn: c.spierpijn,
  pijn: c.pijn,
});

/** Een opgeslagen check voor de app: de vier cijfers en waar je pijn hebt. */
const alsCheck = (c: HerstelWaarden & { datum: Date; pijnPlekken: string[] }) => ({
  datum: uitDatum(c.datum),
  ...waarden(c),
  pijnPlekken: c.pijnPlekken,
});

/** De check van vandaag met signalen, voor het beginscherm. */
export async function herstelVandaag(gebruikerId: string, dag = vandaag()) {
  const checks = await prisma.herstelcheck.findMany({
    where: { gebruikerId, datum: { lte: naarDatum(dag), gte: naarDatum(verschuifDag(dag, -60)) } },
    orderBy: { datum: "desc" },
    take: 30,
  });
  const vandaagCheck = checks[0] && uitDatum(checks[0].datum) === dag ? checks[0] : null;
  const eerder = (vandaagCheck ? checks.slice(1) : checks).map(waarden);
  return {
    check: vandaagCheck && alsCheck(vandaagCheck),
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
    const g = gid(request);
    await prisma.herstelcheck.upsert({
      where: { gebruikerId_datum: { gebruikerId: g, datum: naarDatum(datum) } },
      update: parsed.data,
      create: { gebruikerId: g, datum: naarDatum(datum), ...parsed.data },
    });
    return herstelVandaag(g, datum);
  });

  app.get<{ Querystring: { dagen?: string } }>("/api/herstel", async (request) => {
    const dagen = Math.min(Math.max(Number(request.query.dagen) || 28, 7), 365);
    const checks = await prisma.herstelcheck.findMany({
      where: { gebruikerId: gid(request), datum: { gte: naarDatum(verschuifDag(vandaag(), -(dagen - 1))) } },
      orderBy: { datum: "desc" },
    });
    return { checks: checks.map(alsCheck) };
  });
}
