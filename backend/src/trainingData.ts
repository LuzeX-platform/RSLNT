// Database rond een training: haalt de geschiedenis op en laat de pure regels in progressie.ts
// er het voorstel uit berekenen. Voorstellen worden niet opgeslagen maar bij elke weergave
// berekend uit wat er vóór die training gelogd is. Zo klopt een voorstel altijd met de
// geschiedenis, ook als je achteraf een oude training corrigeert.

import type { Programma } from "@prisma/client";
import { prisma } from "./db.js";
import { bepaalVoorstel, type Doel, type EerdereSessie, type GelogdeSet } from "./progressie.js";
import { bepaalFase, type FaseInstellingen } from "./fase.js";
import { uitDatum } from "./datum.js";

export const SET_VELDEN = { nummer: true, gewicht: true, reps: true, rir: true, kniepijn: true } as const;

type SetRij = GelogdeSet & { nummer: number };

export interface Sessie extends EerdereSessie {
  trainingId: string;
  datum: Date;
  sets: SetRij[];
}

/**
 * Eerdere sessies per oefening, nieuwste eerst, met het plan van die dag (min. sets, doel-RIR,
 * deload). Alleen sessies waarin iets gelogd is: een overgeslagen oefening telt niet als "vorige keer".
 */
export async function historiePerOefening(
  oefeningIds: string[],
  datum: { lt: Date } | { lte: Date },
): Promise<Map<string, Sessie[]>> {
  const regels = await prisma.trainingOefening.findMany({
    where: { oefeningId: { in: oefeningIds }, training: { datum }, sets: { some: {} } },
    include: {
      training: { select: { id: true, datum: true, fase: true } },
      sets: { orderBy: { nummer: "asc" }, select: SET_VELDEN },
    },
    orderBy: [{ training: { datum: "desc" } }, { training: { aangemaaktOp: "desc" } }],
  });
  const perOefening = new Map<string, Sessie[]>();
  for (const r of regels) {
    const lijst = perOefening.get(r.oefeningId) ?? [];
    lijst.push({
      trainingId: r.training.id,
      datum: r.training.datum,
      sets: r.sets,
      minSets: r.minSets,
      doelRir: r.doelRir,
      deload: r.training.fase === "deload",
    });
    perOefening.set(r.oefeningId, lijst);
  }
  return perOefening;
}

export function faseInstellingen(p: Programma): FaseInstellingen {
  return {
    startdatum: uitDatum(p.startdatum),
    introWeken: p.introWeken,
    introSets: p.introSets,
    introRir: p.introRir,
    deloadElkeWeken: p.deloadElkeWeken,
    deloadSetFactor: p.deloadSetFactor,
    deloadTot: p.deloadTot ? uitDatum(p.deloadTot) : null,
  };
}

export async function actiefProgramma() {
  return prisma.programma.findFirst({
    where: { actief: true },
    include: { schemas: { where: { inRotatie: true }, orderBy: { volgorde: "asc" } } },
  });
}

/**
 * De training die aan de beurt is: de volgende in de rotatie na de laatste training van dit
 * programma (A → B → C → A …), los van de weekdag.
 */
export async function volgendeSchema(programma: NonNullable<Awaited<ReturnType<typeof actiefProgramma>>>) {
  const schemas = programma.schemas;
  if (schemas.length === 0) return null;
  const laatste = await prisma.training.findFirst({
    where: { schema: { programmaId: programma.id } },
    orderBy: { datum: "desc" },
    select: { schemaId: true },
  });
  const i = laatste ? schemas.findIndex((s) => s.id === laatste.schemaId) : -1;
  return schemas[(i + 1) % schemas.length];
}

export async function trainingDetail(id: string) {
  const training = await prisma.training.findUnique({
    where: { id },
    include: {
      schema: { select: { code: true, naam: true, programma: { select: { naam: true, opwarmen: true } } } },
      oefeningen: {
        orderBy: { volgorde: "asc" },
        include: { oefening: true, sets: { orderBy: { nummer: "asc" }, select: SET_VELDEN } },
      },
    },
  });
  if (!training) return null;

  const ids = training.oefeningen.map((o) => o.oefeningId);
  const historie = await historiePerOefening(ids, { lt: training.datum });

  // Alternatieven om naar te wisselen: die van de oefening uit het schema (ook na een wissel).
  const origineleIds = training.oefeningen.map((o) => o.origineleOefeningId ?? o.oefeningId);
  const originelen = new Map(
    (await prisma.oefening.findMany({ where: { id: { in: origineleIds } } })).map((o) => [o.id, o]),
  );
  const alternatieven = new Map(
    (
      await prisma.oefening.findMany({
        where: { sleutel: { in: [...originelen.values()].flatMap((o) => o.alternatieven) } },
        select: { id: true, sleutel: true, naam: true },
      })
    ).map((o) => [o.sleutel, o]),
  );

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

  const deload = training.fase === "deload";
  return {
    training: {
      id: training.id,
      schemaId: training.schemaId,
      schemaCode: training.schema.code,
      schemaNaam: training.schema.naam,
      programmaNaam: training.schema.programma.naam,
      opwarmen: training.schema.programma.opwarmen,
      datum: training.datum,
      notitie: training.notitie,
      status: training.status,
      fase: training.fase,
      week: training.week,
      afgerondOp: training.afgerondOp,
    },
    oefeningen: training.oefeningen.map((to) => {
      const eerder = historie.get(to.oefeningId) ?? [];
      const doel: Doel = { minSets: to.minSets, repsMin: to.repsMin, repsMax: to.repsMax };
      const origineel = originelen.get(to.origineleOefeningId ?? to.oefeningId)!;
      return {
        id: to.id,
        oefeningId: to.oefeningId,
        naam: to.oefening.naam,
        materiaal: to.oefening.materiaal,
        gewichtsstap: to.oefening.gewichtsstap,
        perKant: to.oefening.perKant,
        knieGevoelig: to.oefening.knieGevoelig,
        bibliotheekId: to.oefening.bibliotheekId,
        aantalSets: to.aantalSets,
        minSets: to.minSets,
        repsMin: to.repsMin,
        repsMax: to.repsMax,
        supersetGroep: to.supersetGroep,
        rustSeconden: to.rustSeconden,
        doelRir: to.doelRir,
        cue: to.cue,
        gewisseld: to.origineleOefeningId ? { van: origineel.naam } : null,
        alternatieven: [origineel.sleutel, ...origineel.alternatieven]
          .map((s) => (s === origineel.sleutel ? origineel : alternatieven.get(s)))
          .filter((o) => o !== undefined && o.id !== to.oefeningId)
          .map((o) => ({ id: o!.id, naam: o!.naam })),
        sets: to.sets,
        vorigeKeer: eerder[0] ? { datum: eerder[0].datum, sets: eerder[0].sets } : null,
        voorstel: bepaalVoorstel(to.oefening, doel, eerder, { deload }),
        volgendeKeer: vooruit
          ? bepaalVoorstel(to.oefening, huidigDoel.get(to.oefeningId) ?? doel, vooruit.get(to.oefeningId) ?? [])
          : null,
      };
    }),
  };
}

/** De fase voor een training die vandaag start, voor het actieve programma. */
export function faseVoor(programma: Programma, dag: string) {
  return bepaalFase(faseInstellingen(programma), dag);
}
