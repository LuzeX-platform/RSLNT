import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import { gid, requireIngelogd } from "../plugins/requireAuth.js";
import { AFBEELDING_BASIS, type BibliotheekOefening } from "../bibliotheekOmzetten.js";
import {
  bibliotheek,
  CATEGORIE_LABELS,
  inCatalogus,
  kort,
  MATERIAAL_LABELS,
  NIVEAU_LABELS,
  PATROON_LABELS,
  vergelijkbaar,
  zoekOefeningen,
} from "../bibliotheek.js";
import { ALLE_SPIER_LABELS } from "../spieren.js";
import { actiefProgramma } from "../trainingData.js";
import { nieuweSleutel } from "./schemas.js";
import { voorkeuren } from "./personalisatie.js";
import { ongeldig } from "./auth.js";
import { vereistPro } from "../entitlementsPro.js";

const PER_PAGINA = 40;

type Status = "favoriet" | "uitgesloten" | null;

function statusVan(id: string, v: { favorieten: string[]; uitgesloten: string[] }): Status {
  return v.favorieten.includes(id) ? "favoriet" : v.uitgesloten.includes(id) ? "uitgesloten" : null;
}

/**
 * De oefening in de database voor dit bibliotheekitem: eerst op koppeling, dan op de sleutel uit
 * de basislijst, dan op naam. Bestaat ze niet, dan maken we haar aan met de gegevens uit de
 * basislijst (of, daarbuiten, uit de bibliotheek zelf).
 */
async function oefeningVoor(gebruikerId: string, o: BibliotheekOefening, tx: Prisma.TransactionClient) {
  const c = inCatalogus(o.id);
  const naam = c?.naam ?? o.naam.slice(0, 80);
  const bestaand =
    (await tx.oefening.findFirst({ where: { gebruikerId, bibliotheekId: o.id } })) ??
    (c ? await tx.oefening.findUnique({ where: { gebruikerId_sleutel: { gebruikerId, sleutel: c.sleutel } } }) : null) ??
    (await tx.oefening.findFirst({ where: { gebruikerId, naam: { equals: naam, mode: "insensitive" } } }));
  if (bestaand) {
    return bestaand.bibliotheekId ? bestaand : tx.oefening.update({ where: { id: bestaand.id }, data: { bibliotheekId: o.id } });
  }
  return tx.oefening.create({
    data: {
      gebruikerId,
      sleutel: c?.sleutel ?? (await nieuweSleutel(gebruikerId, o.id)),
      naam,
      materiaal: c?.materiaal ?? o.materiaal,
      gewichtsstap: c?.gewichtsstap ?? o.gewichtsstap,
      perKant: c?.perKant ?? o.unilateraal,
      spierenPrimair: c?.spierenPrimair ?? o.spierenPrimair,
      spierenSecundair: c?.spierenSecundair ?? o.spierenSecundair,
      mechaniek: c?.mechaniek ?? o.mechaniek,
      unilateraal: c?.perKant ?? o.unilateraal,
      knieGevoelig: c?.knieGevoelig ?? o.knieGevoelig,
      bibliotheekId: o.id,
    },
  });
}

export async function bibliotheekRoutes(app: FastifyInstance) {
  app.addHook("preHandler", requireIngelogd);
  // De hele oefeningenbibliotheek is Pro — zie de productkaart op luzex.nl.
  app.addHook("preHandler", vereistPro);

  app.get<{
    Querystring: { zoek?: string; spier?: string; materiaal?: string; patroon?: string; knie?: string; lijst?: string; pagina?: string };
  }>("/api/bibliotheek", async (request) => {
    const q = request.query;
    const v = await voorkeuren(gid(request));
    const { bestand } = bibliotheek();
    const ids = q.lijst === "favorieten" ? new Set(v.favorieten) : q.lijst === "uitgesloten" ? new Set(v.uitgesloten) : undefined;
    const gevonden = zoekOefeningen(bestand.oefeningen, {
      zoek: q.zoek?.slice(0, 80),
      spier: q.spier || undefined,
      materiaal: q.materiaal || undefined,
      patroon: q.patroon || undefined,
      knievriendelijk: q.knie === "vriendelijk",
      ids,
    });
    const pagina = Math.max(1, Math.min(Number(q.pagina) || 1, 100));
    return {
      totaal: gevonden.length,
      pagina,
      perPagina: PER_PAGINA,
      oefeningen: gevonden.slice((pagina - 1) * PER_PAGINA, pagina * PER_PAGINA).map((o) => ({ ...kort(o), status: statusVan(o.id, v) })),
      labels: { spieren: ALLE_SPIER_LABELS, materiaal: MATERIAAL_LABELS, patronen: PATROON_LABELS },
      aantallen: { favorieten: v.favorieten.length, uitgesloten: v.uitgesloten.length },
    };
  });

  app.get<{ Params: { id: string } }>("/api/bibliotheek/:id", async (request, reply) => {
    const { bestand, perId } = bibliotheek();
    const o = perId.get(request.params.id);
    if (!o) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    const c = inCatalogus(o.id);
    const g = gid(request);
    const [v, inDatabase, programma] = await Promise.all([
      voorkeuren(g),
      prisma.oefening.findFirst({ where: { gebruikerId: g, bibliotheekId: o.id }, select: { id: true, sleutel: true, naam: true } }),
      actiefProgramma(g),
    ]);
    const inProgramma =
      inDatabase && programma
        ? await prisma.schema.findMany({
            where: { programmaId: programma.id, inRotatie: true, oefeningen: { some: { oefeningId: inDatabase.id } } },
            orderBy: { volgorde: "asc" },
            select: { code: true, naam: true },
          })
        : [];
    return {
      oefening: {
        id: o.id,
        naam: c?.naam ?? o.naam,
        bronNaam: o.naam,
        categorie: CATEGORIE_LABELS[o.categorie] ?? o.categorie,
        niveau: NIVEAU_LABELS[o.niveau] ?? o.niveau,
        mechaniek: o.mechaniek,
        materiaal: o.materiaal,
        patroon: o.patroon,
        spierenPrimair: c?.spierenPrimair ?? o.spierenPrimair,
        spierenSecundair: c?.spierenSecundair ?? o.spierenSecundair,
        knieGevoelig: c ? Boolean(c.knieGevoelig) : o.knieGevoelig,
        knieGeschat: !c,
        schouderBelastend: Boolean(c?.schouderBelastend),
        rugBelastend: Boolean(c?.rugBelastend),
        uitleg: o.uitleg,
        cue: c?.cue ?? null,
        afbeeldingen: o.afbeeldingen.map((a) => AFBEELDING_BASIS + a),
        basislijst: Boolean(c),
      },
      status: statusVan(o.id, v),
      inDatabase,
      inProgramma,
      vergelijkbaar: vergelijkbaar(o, bestand.oefeningen).map((x) => ({ ...kort(x), status: statusVan(x.id, v) })),
      labels: { spieren: ALLE_SPIER_LABELS, materiaal: MATERIAAL_LABELS, patronen: PATROON_LABELS },
      bron: { naam: bestand.bron, url: bestand.url, licentie: bestand.licentie },
    };
  });

  // Favoriet of "niet voor mij": de schemagenerator gebruikt dit.
  app.put<{ Params: { id: string } }>("/api/bibliotheek/:id/status", async (request, reply) => {
    const parsed = z.object({ status: z.enum(["favoriet", "uitgesloten", "geen"]) }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const id = request.params.id;
    if (!bibliotheek().perId.has(id)) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    const g = gid(request);
    const v = await voorkeuren(g);
    const zonder = (lijst: string[]) => lijst.filter((x) => x !== id);
    await prisma.voorkeuren.update({
      where: { gebruikerId: g },
      data: {
        favorieten: parsed.data.status === "favoriet" ? [...zonder(v.favorieten), id] : zonder(v.favorieten),
        uitgesloten: parsed.data.status === "uitgesloten" ? [...zonder(v.uitgesloten), id] : zonder(v.uitgesloten),
      },
    });
    return { status: parsed.data.status === "geen" ? null : parsed.data.status };
  });

  // Een oefening uit de bibliotheek achteraan een training (A, B, C …) zetten.
  app.post<{ Params: { id: string } }>("/api/bibliotheek/:id/toevoegen", async (request, reply) => {
    const parsed = z.object({ schemaId: z.string().min(1) }).safeParse(request.body);
    if (!parsed.success) return ongeldig(reply, parsed.error);
    const o = bibliotheek().perId.get(request.params.id);
    if (!o) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    const g = gid(request);
    const schema = await prisma.schema.findFirst({
      where: { id: parsed.data.schemaId, programma: { gebruikerId: g } },
      include: { oefeningen: true },
    });
    if (!schema) return reply.code(404).send({ errorCode: "NIET_GEVONDEN" });
    const c = inCatalogus(o.id);
    const compound = (c?.mechaniek ?? o.mechaniek) === "compound";
    const resultaat = await prisma.$transaction(async (tx) => {
      const oefening = await oefeningVoor(g, o, tx);
      if (schema.oefeningen.some((r) => r.oefeningId === oefening.id)) return { oefening, alGepland: true };
      await tx.schemaOefening.create({
        data: {
          schemaId: schema.id,
          oefeningId: oefening.id,
          volgorde: Math.max(-1, ...schema.oefeningen.map((r) => r.volgorde)) + 1,
          aantalSets: 3,
          minSets: 3,
          repsMin: compound ? 8 : 10,
          repsMax: compound ? 12 : 15,
          rustSeconden: compound ? 120 : 75,
          doelRir: compound ? 2 : 1,
          cue: c?.cue ?? "",
        },
      });
      return { oefening, alGepland: false };
    });
    if (resultaat.alGepland) return reply.code(409).send({ errorCode: "AL_IN_TRAINING", bericht: `${resultaat.oefening.naam} staat al in ${schema.naam}.` });
    return { oefening: resultaat.oefening, schema: { id: schema.id, code: schema.code, naam: schema.naam } };
  });
}
