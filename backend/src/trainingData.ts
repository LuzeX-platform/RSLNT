// Database rond een training: haalt de geschiedenis op en laat de pure regels in progressie.ts
// er het voorstel uit berekenen. Voorstellen worden niet opgeslagen maar bij elke weergave
// berekend uit wat er vóór die training gelogd is. Zo klopt een voorstel altijd met de
// geschiedenis, ook als je achteraf een oude training corrigeert.

import { prisma } from "./db.js";
import { bepaalVoorstel, type Doel, type GelogdeSet } from "./progressie.js";

export const SET_VELDEN = { nummer: true, gewicht: true, reps: true, rir: true, kniepijn: true } as const;

type SetRij = GelogdeSet & { nummer: number };

export interface Sessie {
  trainingId: string;
  datum: Date;
  sets: SetRij[];
}

/**
 * Eerdere sessies per oefening, nieuwste eerst. Alleen sessies waarin iets gelogd is: een
 * overgeslagen oefening telt niet als "vorige keer".
 */
export async function historiePerOefening(
  oefeningIds: string[],
  datum: { lt: Date } | { lte: Date },
): Promise<Map<string, Sessie[]>> {
  const regels = await prisma.trainingOefening.findMany({
    where: { oefeningId: { in: oefeningIds }, training: { datum }, sets: { some: {} } },
    include: {
      training: { select: { id: true, datum: true } },
      sets: { orderBy: { nummer: "asc" }, select: SET_VELDEN },
    },
    orderBy: [{ training: { datum: "desc" } }, { training: { aangemaaktOp: "desc" } }],
  });
  const perOefening = new Map<string, Sessie[]>();
  for (const r of regels) {
    const lijst = perOefening.get(r.oefeningId) ?? [];
    lijst.push({ trainingId: r.training.id, datum: r.training.datum, sets: r.sets });
    perOefening.set(r.oefeningId, lijst);
  }
  return perOefening;
}

/** Het schema dat aan de beurt is: het volgende na de laatste training (A → B → A …). */
export async function volgendeSchema() {
  const schemas = await prisma.schema.findMany({ orderBy: { volgorde: "asc" }, select: { id: true, naam: true } });
  if (schemas.length === 0) return null;
  const laatste = await prisma.training.findFirst({ orderBy: { datum: "desc" }, select: { schemaId: true } });
  if (!laatste) return schemas[0];
  const i = schemas.findIndex((s) => s.id === laatste.schemaId);
  return schemas[(i + 1) % schemas.length];
}

export async function trainingDetail(id: string) {
  const training = await prisma.training.findUnique({
    where: { id },
    include: {
      schema: { select: { naam: true } },
      oefeningen: {
        orderBy: { volgorde: "asc" },
        include: { oefening: true, sets: { orderBy: { nummer: "asc" }, select: SET_VELDEN } },
      },
    },
  });
  if (!training) return null;

  const ids = training.oefeningen.map((o) => o.oefeningId);
  const historie = await historiePerOefening(ids, { lt: training.datum });

  // Na het afronden ook alvast het voorstel voor de volgende keer, met het doel zoals het nu in
  // het schema staat (als de oefening er nog in zit).
  let vooruit: Map<string, Sessie[]> | null = null;
  let huidigDoel = new Map<string, Doel>();
  if (training.status === "afgerond") {
    vooruit = await historiePerOefening(ids, { lte: training.datum });
    const regels = await prisma.schemaOefening.findMany({
      where: { schemaId: training.schemaId, oefeningId: { in: ids } },
    });
    huidigDoel = new Map(regels.map((r) => [r.oefeningId, r]));
  }

  return {
    training: {
      id: training.id,
      schemaId: training.schemaId,
      schemaNaam: training.schema.naam,
      datum: training.datum,
      notitie: training.notitie,
      status: training.status,
      afgerondOp: training.afgerondOp,
    },
    oefeningen: training.oefeningen.map((to) => {
      const eerder = historie.get(to.oefeningId) ?? [];
      const doel: Doel = { minSets: to.minSets, repsMin: to.repsMin, repsMax: to.repsMax };
      return {
        id: to.id,
        oefeningId: to.oefeningId,
        naam: to.oefening.naam,
        materiaal: to.oefening.materiaal,
        gewichtsstap: to.oefening.gewichtsstap,
        perKant: to.oefening.perKant,
        aantalSets: to.aantalSets,
        minSets: to.minSets,
        repsMin: to.repsMin,
        repsMax: to.repsMax,
        supersetGroep: to.supersetGroep,
        sets: to.sets,
        vorigeKeer: eerder[0] ? { datum: eerder[0].datum, sets: eerder[0].sets } : null,
        voorstel: bepaalVoorstel(to.oefening, doel, eerder),
        volgendeKeer: vooruit
          ? bepaalVoorstel(to.oefening, huidigDoel.get(to.oefeningId) ?? doel, vooruit.get(to.oefeningId) ?? [])
          : null,
      };
    }),
  };
}
