// Database rond een training: haalt de geschiedenis op en laat de pure regels in progressie.ts
// er het voorstel uit berekenen. Voorstellen worden niet opgeslagen maar bij elke weergave
// berekend uit wat er vóór die training gelogd is. Zo klopt een voorstel altijd met de
// geschiedenis, ook als je achteraf een oude training corrigeert.

import type { Programma } from "@prisma/client";
import { prisma } from "./db.js";
import {
  bepaalVoorstel,
  isWerkset,
  PROGRESSIE_REGELS,
  werkgewicht,
  type Doel,
  type EerdereSessie,
  type GelogdeSet,
  type ProgressieRegel,
} from "./progressie.js";
import { bepaalFase, type Fase, type FaseInstellingen } from "./fase.js";
import { uitDatum, vandaag } from "./datum.js";
import { aanDeBeurt, maandagVan } from "./planning.js";
import { dagVan } from "./voortgang.js";
import { opwarmsets } from "./opwarmen.js";
import { bijsturing } from "./autoregulatie.js";
import { blokOp, type BlokOpDag, type Blokplan } from "./periodisering.js";
import { richtgewicht } from "./analyse.js";
import { besteE1rm } from "./voortgang.js";
import { heeftPro } from "./entitlementsPro.js";

export const SET_VELDEN = { nummer: true, gewicht: true, reps: true, rir: true, pijn: true, pijnPlek: true, soort: true } as const;

/** Een techniek uit het schema en de soort set die daarbij hoort. */
export const TECHNIEK_SETSOORT = { dropset: "drop", myoreps: "myo", restpauze: "restpauze" } as const;
export type Techniek = keyof typeof TECHNIEK_SETSOORT;
export const TECHNIEKEN = Object.keys(TECHNIEK_SETSOORT) as [Techniek, ...Techniek[]];

export const alsRegel = (r: string | null | undefined): ProgressieRegel =>
  (PROGRESSIE_REGELS as readonly string[]).includes(r ?? "") ? (r as ProgressieRegel) : "dubbel";

type SetRij = GelogdeSet & { nummer: number };

export interface Sessie extends EerdereSessie {
  trainingId: string;
  datum: Date;
  sets: SetRij[];
  blok: string | null;
}

/**
 * Eerdere sessies per oefening, nieuwste eerst, met het plan van die dag (min. sets, doel-RIR,
 * deload). Alleen sessies waarin iets gelogd is: een overgeslagen oefening telt niet als "vorige keer".
 */
export async function historiePerOefening(
  gebruikerId: string,
  oefeningIds: string[],
  datum: { lt: Date } | { lte: Date },
): Promise<Map<string, Sessie[]>> {
  const regels = await prisma.trainingOefening.findMany({
    where: { oefeningId: { in: oefeningIds }, training: { gebruikerId, datum }, sets: { some: {} } },
    include: {
      training: { select: { id: true, datum: true, fase: true, blok: true } },
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
      // Een lichte dag is bewust licht, net als een deload: telt niet voor progressie of stagnatie.
      deload: r.training.fase === "deload" || r.training.fase === "licht",
      blok: r.training.blok,
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

export async function actiefProgramma(gebruikerId: string) {
  return prisma.programma.findFirst({
    where: { gebruikerId, actief: true },
    include: { schemas: { where: { inRotatie: true }, orderBy: { volgorde: "asc" } } },
  });
}

/**
 * Wat de weekplanner voor vandaag zegt (planning.ts), alleen met planning voor dit programma.
 * null = geen planning: dan geldt de rotatie.
 */
export async function planningVoor(programma: NonNullable<Awaited<ReturnType<typeof actiefProgramma>>>, dag = vandaag()) {
  const ids = new Set(programma.schemas.map((x) => x.id));
  const planning = (await prisma.planning.findMany({ where: { gebruikerId: programma.gebruikerId } })).filter((p) => ids.has(p.schemaId));
  if (planning.length === 0) return null;
  const maandag = maandagVan(dag);
  const recent = await prisma.training.findMany({
    where: { gebruikerId: programma.gebruikerId, datum: { gte: new Date(Date.now() - 8 * 86400_000) } },
    select: { schemaId: true, datum: true },
  });
  const gedaan = new Set(recent.filter((t) => dagVan(t.datum) >= maandag && dagVan(t.datum) <= dag).map((t) => t.schemaId));
  const beurt = aanDeBeurt(planning, dag, gedaan);
  const schema = (id: string) => programma.schemas.find((x) => x.id === id)!;
  return {
    vandaag: beurt.vandaag && { ...beurt.vandaag, naam: schema(beurt.vandaag.schemaId).naam },
    volgende: beurt.volgende && { ...beurt.volgende, naam: schema(beurt.volgende.schemaId).naam },
  };
}

/**
 * De training die aan de beurt is. Staat er vandaag een gepland (en nog niet gedaan): die. Anders
 * (rustdag, of zonder weekplanning) de volgende in de rotatie na de laatste training van dit
 * programma (A → B → C → A …): wie op een rustdag toch traint, of een dag inhaalt, doet de
 * training die in de volgorde aan de beurt is.
 */
export async function volgendeSchema(programma: NonNullable<Awaited<ReturnType<typeof actiefProgramma>>>) {
  const schemas = programma.schemas;
  if (schemas.length === 0) return null;
  const plan = await planningVoor(programma);
  const gepland = plan?.vandaag;
  if (gepland) return schemas.find((x) => x.id === gepland.schemaId)!;
  const laatste = await prisma.training.findFirst({
    where: { gebruikerId: programma.gebruikerId, schema: { programmaId: programma.id } },
    orderBy: { datum: "desc" },
    select: { schemaId: true },
  });
  const i = laatste ? schemas.findIndex((s) => s.id === laatste.schemaId) : -1;
  return schemas[(i + 1) % schemas.length];
}

/** Eén training van dit account; null als die niet bestaat of van iemand anders is. */
export async function trainingDetail(gebruikerId: string, id: string) {
  const pro = await heeftPro(gebruikerId);
  const training = await prisma.training.findFirst({
    where: { id, gebruikerId },
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
  const historie = await historiePerOefening(gebruikerId, ids, { lt: training.datum });

  // Alternatieven om naar te wisselen: die van de oefening uit het schema (ook na een wissel).
  const origineleIds = training.oefeningen.map((o) => o.origineleOefeningId ?? o.oefeningId);
  const originelen = new Map(
    (await prisma.oefening.findMany({ where: { gebruikerId, id: { in: origineleIds } } })).map((o) => [o.id, o]),
  );
  const alternatieven = new Map(
    (
      await prisma.oefening.findMany({
        where: { gebruikerId, sleutel: { in: [...originelen.values()].flatMap((o) => o.alternatieven) } },
        select: { id: true, sleutel: true, naam: true },
      })
    ).map((o) => [o.sleutel, o]),
  );

  // Na het afronden ook alvast het voorstel voor de volgende keer, met het doel zoals het nu in
  // het schema staat (als de oefening er nog in zit).
  let vooruit: Map<string, Sessie[]> | null = null;
  let huidigDoel = new Map<string, Doel & { progressie?: string }>();
  if (training.status === "afgerond") {
    vooruit = await historiePerOefening(gebruikerId, ids, { lte: training.datum });
    const regels = await prisma.schemaOefening.findMany({
      where: { schemaId: training.schemaId, oefeningId: { in: ids } },
    });
    huidigDoel = new Map(regels.map((r) => [r.oefeningId, r]));
  }

  const deload = training.fase === "deload" || training.fase === "licht";
  return {
    pro,
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
      blok: training.blok,
      afgerondOp: training.afgerondOp,
    },
    oefeningen: training.oefeningen.map((to) => {
      const eerder = historie.get(to.oefeningId) ?? [];
      const doel: Doel = { minSets: to.minSets, repsMin: to.repsMin, repsMax: to.repsMax };
      const origineel = originelen.get(to.origineleOefeningId ?? to.oefeningId)!;
      const regel = alsRegel(to.progressie);
      const voorstel = bepaalVoorstel(to.oefening, doel, eerder, { deload, regel });
      const werksets = to.sets.filter(isWerkset);
      // Opwarmen (gratis): naar het voorgestelde gewicht, of wat je vorige keer deed.
      const vorigWerk = eerder[0] ? werkgewicht({ sets: eerder[0].sets.filter(isWerkset) }) : null;
      const opwarmen = opwarmsets(voorstel.gewicht ?? vorigWerk, to.oefening.gewichtsstap, to.oefening.materiaal);
      // Nieuw blok (Pro): een richtgewicht uit je geschatte 1RM. Alleen informatie; het voorstel
      // blijft binnen de harde regels (max. één stap omhoog). Zie Wetenschap, #periodisering.
      let blokRichtgewicht: { gewicht: number; reden: string } | null = null;
      if (training.blok && eerder[0] && eerder[0].blok !== training.blok && to.oefening.gewichtsstap > 0) {
        const e1rms = eerder.slice(0, 3).map((s) => besteE1rm(s.sets.filter(isWerkset))).filter((w): w is number => w !== null);
        if (e1rms.length) {
          const gewicht = richtgewicht(Math.max(...e1rms), to.repsMax, to.doelRir ?? 2, to.oefening.gewichtsstap);
          if (gewicht > 0) {
            blokRichtgewicht = {
              gewicht,
              reden: `Nieuw blok: met je geschatte 1RM haal je ${to.repsMax} reps met ${to.doelRir ?? 2} over bij ongeveer dit gewicht. Het voorstel gaat nooit meer dan één stap omhoog; kies zelf.`,
            };
          }
        }
      }
      return {
        id: to.id,
        oefeningId: to.oefeningId,
        naam: to.oefening.naam,
        materiaal: to.oefening.materiaal,
        gewichtsstap: to.oefening.gewichtsstap,
        perKant: to.oefening.perKant,
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
        mechaniek: to.oefening.mechaniek,
        progressie: regel,
        techniek: to.techniek,
        sets: to.sets,
        vorigeKeer: eerder[0] ? { datum: eerder[0].datum, sets: eerder[0].sets } : null,
        voorstel,
        opwarmen,
        blokRichtgewicht,
        // Pro: bijsturen voor de volgende set, uit de sets die je vandaag al deed.
        bijsturing:
          pro && training.status === "bezig"
            ? bijsturing(to.oefening, { repsMin: to.repsMin, repsMax: to.repsMax, doelRir: to.doelRir, aantalSets: to.aantalSets }, werksets)
            : null,
        volgendeKeer: vooruit
          ? bepaalVoorstel(to.oefening, huidigDoel.get(to.oefeningId) ?? doel, vooruit.get(to.oefeningId) ?? [], {
              regel: pro ? alsRegel(huidigDoel.get(to.oefeningId)?.progressie ?? to.progressie) : "dubbel",
            })
          : null,
      };
    }),
  };
}

/** Het blokplan van een programma, of null. Alleen met Pro telt het mee (zie faseVoor). */
export function blokplanVan(programma: Programma): Blokplan | null {
  const plan = programma.periodisering as unknown as Blokplan | null;
  return plan && typeof plan === "object" && Array.isArray(plan.blokken) ? plan : null;
}

/**
 * De fase voor een training die vandaag start, voor het actieve programma. Met een lopend
 * blokplan (Pro) bepaalt het plan wanneer je deloadt, niet "elke zoveelste week": anders zou een
 * automatische deload midden in je piekblok kunnen vallen. Een handmatige deload en de introfase
 * gaan wel altijd voor.
 */
export function faseVoor(programma: Programma, dag: string, pro = false): Fase & { blok: BlokOpDag | null } {
  const blok = pro ? blokOp(blokplanVan(programma), dag) : null;
  const instellingen = faseInstellingen(programma);
  const fase = bepaalFase(blok ? { ...instellingen, deloadElkeWeken: null } : instellingen, dag);
  if (blok?.soort === "deload" && fase.fase === "normaal") return { ...fase, fase: "deload", blok };
  return { ...fase, blok };
}
