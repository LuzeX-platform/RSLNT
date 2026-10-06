import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";
import { isDag, naarDatum, uitDatum, vandaag, verschuifDag } from "../datum.js";
import { zevenDaagsGemiddelde } from "../gewicht.js";
import {
  ACTIVITEIT,
  aanbevolenTempo,
  bmi,
  bmiCategorie,
  bmrKatch,
  bmrMifflin,
  calorieDoel,
  dagverbruik,
  eiwitDoel,
  ffmi,
  leeftijd,
  tailleLengte,
  tempoAdvies,
  tijdlijn,
  trendKgPerWeek,
  vetNavy,
  vetvrijeMassa,
  type Activiteit,
  type Geslacht,
} from "../lichaam.js";
import { programmaDoel } from "../spieren.js";
import { ongeldig } from "./auth.js";

const profielSchema = z.object({
  geboortedatum: z.string().refine(isDag, "Ongeldige datum").nullable().optional(),
  geslacht: z.enum(["man", "vrouw"]).nullable().optional(),
  lengteCm: z.number().min(100).max(250).nullable().optional(),
  activiteit: z.enum(Object.keys(ACTIVITEIT) as [Activiteit, ...Activiteit[]]).optional(),
  doelgewicht: z.number().min(30).max(300).nullable().optional(),
  tempoMin: z.number().min(-2).max(2).nullable().optional(),
  tempoMax: z.number().min(-2).max(2).nullable().optional(),
  streefdatum: z.string().refine(isDag, "Ongeldige datum").nullable().optional(),
});

const maat = z.number().min(10).max(250).nullable().optional();
const metingSchema = z.object({
  vetpercentage: z.number().min(2).max(70).nullable().optional(),
  tailleCm: maat,
  nekCm: maat,
  heupCm: maat,
  armCm: maat,
  borstCm: maat,
  dijCm: maat,
});

export async function profiel(gebruikerId: string) {
  const bestaand = await prisma.profiel.findUnique({ where: { gebruikerId } });
  if (bestaand) return bestaand;
  try {
    return await prisma.profiel.create({ data: { gebruikerId } });
  } catch {
    // Twee verzoeken tegelijk (de pagina haalt /api/lichaam en /api/profiel samen op): de ander was eerst.
    return prisma.profiel.findUniqueOrThrow({ where: { gebruikerId } });
  }
}

/** Doelgewicht en tempo: eerst wat je zelf instelde, anders het doel uit je actieve programma. */
export async function effectiefDoel(p: Awaited<ReturnType<typeof profiel>>) {
  const actief = await prisma.programma.findFirst({ where: { gebruikerId: p.gebruikerId, actief: true }, select: { bron: true } });
  const uitProgramma = programmaDoel(actief?.bron ?? null);
  return {
    gewicht: p.doelgewicht ?? uitProgramma.gewicht,
    tempoMin: p.tempoMin ?? uitProgramma.tempoMin,
    tempoMax: p.tempoMax ?? uitProgramma.tempoMax,
    bron: p.doelgewicht !== null || p.tempoMin !== null ? "profiel" : uitProgramma.gewicht !== null ? "programma" : null,
  };
}

function profielUit(p: Awaited<ReturnType<typeof profiel>>) {
  return {
    geboortedatum: p.geboortedatum ? uitDatum(p.geboortedatum) : null,
    geslacht: p.geslacht as Geslacht | null,
    lengteCm: p.lengteCm,
    activiteit: p.activiteit as Activiteit,
    doelgewicht: p.doelgewicht,
    tempoMin: p.tempoMin,
    tempoMax: p.tempoMax,
    streefdatum: p.streefdatum ? uitDatum(p.streefdatum) : null,
  };
}

/** Je huidige gewicht voor berekeningen: het 7-daags gemiddelde, anders je laatste weging. */
export async function huidigGewicht(gebruikerId: string, dag: string): Promise<number | null> {
  const [wegingen, laatste] = await Promise.all([
    prisma.lichaamsgewicht.findMany({ where: { gebruikerId, datum: { gte: naarDatum(verschuifDag(dag, -13)) } }, orderBy: { datum: "asc" } }),
    prisma.lichaamsgewicht.findFirst({ where: { gebruikerId }, orderBy: { datum: "desc" } }),
  ]);
  const reeks = wegingen.map((w) => ({ datum: uitDatum(w.datum), gewicht: w.gewicht }));
  return zevenDaagsGemiddelde(reeks, dag) ?? laatste?.gewicht ?? null;
}

export async function lichaamRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);

  app.get("/api/profiel", async (request) => {
    const p = await profiel(gid(request));
    return { profiel: profielUit(p), doel: await effectiefDoel(p), activiteiten: ACTIVITEIT };
  });

  app.put("/api/profiel", async (request, reply) => {
    const parsed = profielSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const { geboortedatum, streefdatum, ...rest } = parsed.data;
    const g = gid(request);
    await profiel(g);
    const p = await prisma.profiel.update({
      where: { gebruikerId: g },
      data: {
        ...rest,
        ...(geboortedatum !== undefined ? { geboortedatum: geboortedatum ? naarDatum(geboortedatum) : null } : {}),
        ...(streefdatum !== undefined ? { streefdatum: streefdatum ? naarDatum(streefdatum) : null } : {}),
      },
    });
    return { profiel: profielUit(p) };
  });

  app.put<{ Params: { datum: string } }>("/api/lichaamsmetingen/:datum", async (request, reply) => {
    const { datum } = request.params;
    if (!isDag(datum) || datum > verschuifDag(vandaag(), 1)) return reply.code(400).send({ errorCode: "ONGELDIGE_DATUM" });
    const parsed = metingSchema.safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const g = gid(request);
    await prisma.lichaamsmeting.upsert({
      where: { gebruikerId_datum: { gebruikerId: g, datum: naarDatum(datum) } },
      update: parsed.data,
      create: { gebruikerId: g, datum: naarDatum(datum), ...parsed.data },
    });
    return { ok: true };
  });

  app.delete<{ Params: { datum: string } }>("/api/lichaamsmetingen/:datum", async (request, reply) => {
    if (!isDag(request.params.datum)) return reply.code(400).send({ errorCode: "ONGELDIGE_DATUM" });
    await prisma.lichaamsmeting.deleteMany({ where: { gebruikerId: gid(request), datum: naarDatum(request.params.datum) } });
    return { ok: true };
  });

  // Alles voor het gezondheidsmenu in één keer: invoer, afgeleide waarden en wat er nog ontbreekt.
  app.get("/api/lichaam", async (request) => {
    const g = gid(request);
    const dag = vandaag();
    const p = await profiel(g);
    const doel = await effectiefDoel(p);
    const [wegingen, laatsteWeging, metingen] = await Promise.all([
      prisma.lichaamsgewicht.findMany({ where: { gebruikerId: g, datum: { gte: naarDatum(verschuifDag(dag, -41)) } }, orderBy: { datum: "asc" } }),
      prisma.lichaamsgewicht.findFirst({ where: { gebruikerId: g }, orderBy: { datum: "desc" } }),
      prisma.lichaamsmeting.findMany({ where: { gebruikerId: g }, orderBy: { datum: "desc" }, take: 30 }),
    ]);
    const reeks = wegingen.map((w) => ({ datum: uitDatum(w.datum), gewicht: w.gewicht }));
    const gemiddelde7 = zevenDaagsGemiddelde(reeks, dag);
    const kg = gemiddelde7 ?? laatsteWeging?.gewicht ?? null;
    const trend = trendKgPerWeek(reeks, dag);
    const geslacht = p.geslacht as Geslacht | null;
    const ontbreekt: string[] = [];
    if (kg === null) ontbreekt.push("gewicht");
    if (!p.lengteCm) ontbreekt.push("lengte");
    if (!p.geboortedatum) ontbreekt.push("geboortedatum");
    if (!geslacht) ontbreekt.push("geslacht");

    // Vetpercentage: de nieuwste meting die er een oplevert. Zelf gemeten gaat voor geschat.
    let vet: { waarde: number; bron: "gemeten" | "geschat"; datum: string } | null = null;
    for (const m of metingen) {
      if (m.vetpercentage !== null) {
        vet = { waarde: m.vetpercentage, bron: "gemeten", datum: uitDatum(m.datum) };
        break;
      }
      if (geslacht && p.lengteCm && m.tailleCm && m.nekCm) {
        const geschat = vetNavy({ geslacht, lengteCm: p.lengteCm, tailleCm: m.tailleCm, nekCm: m.nekCm, heupCm: m.heupCm });
        if (geschat !== null) {
          vet = { waarde: geschat, bron: "geschat", datum: uitDatum(m.datum) };
          break;
        }
      }
    }
    const taille = metingen.find((m) => m.tailleCm !== null);

    const samenstelling: Record<string, unknown> = {};
    if (kg !== null && p.lengteCm) {
      const waarde = bmi(kg, p.lengteCm);
      samenstelling.bmi = { waarde, categorie: bmiCategorie(waarde) };
      if (taille) samenstelling.tailleLengte = { ...tailleLengte(taille.tailleCm!, p.lengteCm), datum: uitDatum(taille.datum) };
    }
    let vvm: number | null = null;
    if (kg !== null && vet) {
      vvm = vetvrijeMassa(kg, vet.waarde);
      samenstelling.vet = { ...vet, vetvrijeMassa: vvm };
      if (p.lengteCm) samenstelling.ffmi = ffmi(vvm, p.lengteCm);
    }

    let energie = null;
    if (kg !== null) {
      const jaren = p.geboortedatum ? leeftijd(uitDatum(p.geboortedatum), dag) : null;
      const mifflin = p.lengteCm && jaren !== null && geslacht ? bmrMifflin({ kg, lengteCm: p.lengteCm, leeftijd: jaren, geslacht }) : null;
      const katch = vvm !== null ? bmrKatch(vvm) : null;
      const bmr = katch ?? mifflin;
      if (bmr !== null) {
        const onderhoud = dagverbruik(bmr, p.activiteit as Activiteit);
        energie = {
          bmr,
          methode: katch !== null ? "Katch-McArdle" : "Mifflin-St Jeor",
          leeftijd: jaren,
          onderhoud,
          calorie: calorieDoel(onderhoud),
          eiwit: eiwitDoel(kg),
        };
      }
    }

    const tempoMin = doel.tempoMin ?? (kg !== null ? aanbevolenTempo(kg).min : 0.25);
    const tempoMax = doel.tempoMax ?? (kg !== null ? aanbevolenTempo(kg).max : 0.5);
    return {
      vandaag: dag,
      profiel: profielUit(p),
      doel: { ...doel, tempoMin, tempoMax },
      gewicht: {
        gemiddelde7,
        laatste: laatsteWeging && { datum: uitDatum(laatsteWeging.datum), gewicht: laatsteWeging.gewicht },
        trend,
        ...tempoAdvies(trend, tempoMin, tempoMax),
        aanbevolen: kg !== null ? aanbevolenTempo(kg) : null,
        tijdlijn: kg !== null && doel.gewicht !== null ? tijdlijn(kg, doel.gewicht, tempoMin, tempoMax, dag) : null,
      },
      samenstelling,
      energie,
      ontbreekt,
      metingen: metingen.map((m) => ({
        datum: uitDatum(m.datum),
        vetpercentage: m.vetpercentage,
        tailleCm: m.tailleCm,
        nekCm: m.nekCm,
        heupCm: m.heupCm,
        armCm: m.armCm,
        borstCm: m.borstCm,
        dijCm: m.dijCm,
      })),
    };
  });
}
