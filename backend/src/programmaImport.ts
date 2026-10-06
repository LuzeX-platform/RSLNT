// Een trainingsprogramma inlezen uit het JSON-formaat (schema_version 1), zodat je schema's ook
// met een andere AI of in een editor kunt ontwerpen. Twee stappen:
//   1. valideerProgramma(): puur, zonder database. Klopt het bestand en verwijst alles naar
//      oefeningen die erin staan?
//   2. importeerProgramma(): zet het in de database. Oefeningen worden op sleutel (exercise.id)
//      bijgewerkt of aangemaakt, zodat je geschiedenis bij dezelfde oefening blijft.
// Regels die RSLNT (nog) niet uitvoert, komen terug als waarschuwing in plaats van stil genegeerd.

import { z } from "zod";
import type { Prisma, PrismaClient } from "@prisma/client";
import { naarDatum, vandaag } from "./datum.js";

const sleutel = z.string().regex(/^[a-z0-9_]+$/, "Alleen kleine letters, cijfers en _");

const MATERIAAL: Record<string, string> = {
  dumbbell: "dumbbell",
  barbell: "barbell",
  trap_bar: "trap_bar",
  cable: "kabel",
  machine: "machine",
  bodyweight: "lichaamsgewicht",
};

const oefeningSchema = z.object({
  id: sleutel,
  name: z.string().trim().min(1).max(80),
  muscles_primary: z.array(z.string()).default([]),
  muscles_secondary: z.array(z.string()).default([]),
  equipment: z.enum(Object.keys(MATERIAAL) as [string, ...string[]]),
  mechanic: z.enum(["compound", "isolation"]).optional(),
  unilateral: z.boolean().default(false),
  knee_sensitive: z.boolean().default(false),
  increment_kg: z.number().min(0).max(50),
  alternatives: z.array(sleutel).default([]),
});

const regelSchema = z
  .object({
    order: z.number().int().optional(),
    exercise_id: sleutel,
    sets: z.number().int().min(1).max(10),
    min_sets: z.number().int().min(1).max(10).optional(),
    rep_min: z.number().int().min(1).max(100),
    rep_max: z.number().int().min(1).max(100),
    per_side: z.boolean().default(false),
    rest_seconds: z.number().int().min(0).max(900).optional(),
    target_rir: z.number().int().min(0).max(5).optional(),
    cue: z.string().max(300).default(""),
    superset: z.string().max(4).optional(),
  })
  .refine((r) => r.rep_min <= r.rep_max, { message: "rep_min is hoger dan rep_max" });

const workoutSchema = z.object({
  id: z.string().regex(/^[A-Z0-9]{1,3}$/, "Workout-id: A, B, C …"),
  name: z.string().trim().min(1).max(40),
  focus: z.array(z.string()).default([]),
  estimated_minutes: z.number().int().min(5).max(300).optional(),
  exercises: z.array(regelSchema).min(1).max(20),
});

const bestandSchema = z.object({
  schema_version: z.literal(1),
  program: z.object({
    id: sleutel,
    name: z.string().trim().min(1).max(60),
    sessions_per_week: z.tuple([z.number().int().min(1).max(7), z.number().int().min(1).max(7)]).optional(),
    schedule_mode: z.literal("rotation").default("rotation"),
    rotation: z.array(z.string()).optional(),
    min_rest_days_between_sessions: z.number().int().min(0).max(3).default(0),
    warmup: z.string().max(500).default(""),
    goal: z.unknown().optional(),
  }),
  rules: z
    .object({
      intro_phase: z
        .object({
          weeks: z.number().int().min(0).max(12),
          sets_override: z.number().int().min(1).max(10).optional(),
          target_rir: z.number().int().min(0).max(5).optional(),
        })
        .optional(),
      progression: z.object({ type: z.string() }).passthrough().optional(),
      knee_rule: z.unknown().optional(),
      deload: z
        .object({
          every_n_weeks: z.number().int().min(2).max(26),
          sets_multiplier: z.number().min(0.1).max(1).default(0.5),
          load_multiplier: z.number().min(0.1).max(1).default(1),
        })
        .optional(),
      ai_swap: z.unknown().optional(),
    })
    .passthrough()
    .default({}),
  muscle_labels_nl: z.record(z.string()).optional(),
  workouts: z.array(workoutSchema).min(1).max(7),
  exercises: z.array(oefeningSchema).min(1).max(500),
});

export type ProgrammaBestand = z.infer<typeof bestandSchema>;

export type Validatie =
  | { ok: true; bestand: ProgrammaBestand; waarschuwingen: string[] }
  | { ok: false; fouten: string[] };

/** Controleert het bestand en alle onderlinge verwijzingen. Puur, zonder database. */
export function valideerProgramma(invoer: unknown): Validatie {
  const parsed = bestandSchema.safeParse(invoer);
  if (!parsed.success) {
    return {
      ok: false,
      fouten: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".") || "bestand"}: ${i.message}`),
    };
  }
  const bestand = parsed.data;
  const fouten: string[] = [];
  const waarschuwingen: string[] = [];

  const ids = new Set<string>();
  for (const o of bestand.exercises) {
    if (ids.has(o.id)) fouten.push(`Oefening ${o.id} staat twee keer in exercises.`);
    ids.add(o.id);
  }
  for (const o of bestand.exercises) {
    for (const alt of o.alternatives) {
      if (!ids.has(alt)) fouten.push(`Alternatief ${alt} van ${o.id} staat niet in exercises.`);
      if (alt === o.id) fouten.push(`${o.id} heeft zichzelf als alternatief.`);
    }
  }

  const workoutIds = new Set<string>();
  for (const w of bestand.workouts) {
    if (workoutIds.has(w.id)) fouten.push(`Workout ${w.id} staat er twee keer in.`);
    workoutIds.add(w.id);
    const inWorkout = new Set<string>();
    for (const r of w.exercises) {
      if (!ids.has(r.exercise_id)) fouten.push(`Workout ${w.id}: oefening ${r.exercise_id} staat niet in exercises.`);
      if (inWorkout.has(r.exercise_id)) fouten.push(`Workout ${w.id}: ${r.exercise_id} staat er twee keer in.`);
      inWorkout.add(r.exercise_id);
      if (r.min_sets !== undefined && r.min_sets > r.sets) fouten.push(`Workout ${w.id}: min_sets van ${r.exercise_id} is hoger dan sets.`);
    }
  }
  for (const code of bestand.program.rotation ?? []) {
    if (!workoutIds.has(code)) fouten.push(`Rotatie noemt workout ${code}, maar die bestaat niet.`);
  }

  const regels = bestand.rules;
  if (regels.progression && regels.progression.type !== "double_progression") {
    waarschuwingen.push(`Progressie "${regels.progression.type}" kent RSLNT niet; je krijgt dubbele progressie.`);
  }
  if (regels.deload && regels.deload.load_multiplier !== 1) {
    waarschuwingen.push("Deload met minder gewicht (load_multiplier) wordt nog niet ondersteund: alleen minder sets.");
  }
  if (regels.knee_rule !== undefined) {
    waarschuwingen.push("Kniepijnregel: RSLNT gebruikt de afgesproken regel (0–10, terug bij ≥ 4 of +2) voor knie-gevoelige oefeningen.");
  }

  return fouten.length ? { ok: false, fouten } : { ok: true, bestand, waarschuwingen };
}

/** Zet een gevalideerd programma in de database. Bestaat het al (zelfde program.id), dan wordt het bijgewerkt. */
export async function importeerProgramma(
  prisma: PrismaClient,
  bestand: ProgrammaBestand,
  opties: { activeren: boolean },
): Promise<{ id: string; nieuw: boolean }> {
  return prisma.$transaction(async (tx) => {
    // 1. Oefeningen op sleutel. Per kant: als het programma dat ergens zegt, of bij unilaterale oefeningen.
    const perKant = new Set(bestand.workouts.flatMap((w) => w.exercises.filter((r) => r.per_side).map((r) => r.exercise_id)));
    const oefeningIds = new Map<string, string>();
    for (const o of bestand.exercises) {
      const data = {
        naam: o.name,
        materiaal: MATERIAAL[o.equipment],
        gewichtsstap: o.increment_kg,
        perKant: perKant.has(o.id) || o.unilateral,
        spierenPrimair: o.muscles_primary,
        spierenSecundair: o.muscles_secondary,
        mechaniek: o.mechanic ?? null,
        unilateraal: o.unilateral,
        knieGevoelig: o.knee_sensitive,
        alternatieven: o.alternatives,
      };
      const naamBezet = await tx.oefening.findFirst({ where: { naam: o.name, NOT: { sleutel: o.id } } });
      if (naamBezet) {
        throw new ImportFout(`De naam "${o.name}" is al in gebruik door een andere oefening (${naamBezet.sleutel}).`);
      }
      const rij = await tx.oefening.upsert({ where: { sleutel: o.id }, update: data, create: { sleutel: o.id, ...data } });
      oefeningIds.set(o.id, rij.id);
    }

    // 2. Het programma zelf.
    const p = bestand.program;
    const intro = bestand.rules.intro_phase;
    const deload = bestand.rules.deload;
    const velden = {
      naam: p.name,
      sessiesPerWeekMin: p.sessions_per_week?.[0] ?? 2,
      sessiesPerWeekMax: p.sessions_per_week?.[1] ?? 3,
      minRustdagen: p.min_rest_days_between_sessions,
      opwarmen: p.warmup,
      introWeken: intro?.weeks ?? 0,
      introSets: intro?.sets_override ?? null,
      introRir: intro?.target_rir ?? null,
      deloadElkeWeken: deload?.every_n_weeks ?? null,
      deloadSetFactor: deload?.sets_multiplier ?? 0.5,
      bron: bestand as unknown as Prisma.InputJsonValue,
    };
    const bestaand = await tx.programma.findUnique({ where: { sleutel: p.id } });
    const programma = bestaand
      ? await tx.programma.update({ where: { id: bestaand.id }, data: velden })
      : await tx.programma.create({ data: { sleutel: p.id, startdatum: naarDatum(vandaag()), ...velden } });

    // 3. De trainingen (A, B, C …). Bestaande schema's worden bijgewerkt in plaats van vervangen:
    //    eerdere trainingen verwijzen ernaar.
    const rotatie = p.rotation ?? bestand.workouts.map((w) => w.id);
    await tx.schema.updateMany({ where: { programmaId: programma.id }, data: { inRotatie: false } });
    for (const w of bestand.workouts) {
      const plek = rotatie.indexOf(w.id);
      const schemaData = {
        naam: w.name,
        volgorde: plek >= 0 ? plek : rotatie.length + bestand.workouts.indexOf(w),
        minuten: w.estimated_minutes ?? null,
        focus: w.focus,
        inRotatie: plek >= 0,
      };
      const schema = await tx.schema.upsert({
        where: { programmaId_code: { programmaId: programma.id, code: w.id } },
        update: schemaData,
        create: { programmaId: programma.id, code: w.id, ...schemaData },
      });
      await tx.schemaOefening.deleteMany({ where: { schemaId: schema.id } });
      const gesorteerd = [...w.exercises].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
      await tx.schemaOefening.createMany({
        data: gesorteerd.map((r, i) => ({
          schemaId: schema.id,
          oefeningId: oefeningIds.get(r.exercise_id)!,
          volgorde: i,
          aantalSets: r.sets,
          minSets: r.min_sets ?? r.sets,
          repsMin: r.rep_min,
          repsMax: r.rep_max,
          supersetGroep: r.superset ?? null,
          rustSeconden: r.rest_seconds ?? null,
          doelRir: r.target_rir ?? null,
          cue: r.cue,
        })),
      });
    }

    if (opties.activeren) await activeer(tx, programma.id);
    return { id: programma.id, nieuw: !bestaand };
  });
}

/**
 * Maakt dit het actieve programma. Komt het van inactief, dan begint het opnieuw bij week 1
 * (en dus met de introfase): na een andere opbouw horen je pezen en knieën weer te wennen.
 */
export async function activeer(tx: Prisma.TransactionClient, programmaId: string) {
  const programma = await tx.programma.findUniqueOrThrow({ where: { id: programmaId } });
  await tx.programma.updateMany({ where: { NOT: { id: programmaId } }, data: { actief: false } });
  if (!programma.actief) {
    await tx.programma.update({
      where: { id: programmaId },
      data: { actief: true, startdatum: naarDatum(vandaag()), deloadTot: null },
    });
  }
}

export class ImportFout extends Error {}
