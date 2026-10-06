-- Fase 1b: programma's (geïmporteerd uit JSON), oefeningmetadata, rust/doel-RIR/cue per oefening,
-- introfase en deload. Met de hand aangepast zodat bestaande data blijft werken:
--   * het bestaande schema A/B wordt het programma "Full body A/B";
--   * bestaande oefeningen krijgen de sleutel uit de nieuwe programma-JSON als de naam daarbij
--     hoort, zodat "vorige keer" en het voorstel na de import gewoon doorlopen.

-- CreateTable
CREATE TABLE "Programma" (
    "id" TEXT NOT NULL,
    "sleutel" TEXT NOT NULL,
    "naam" TEXT NOT NULL,
    "actief" BOOLEAN NOT NULL DEFAULT false,
    "startdatum" DATE NOT NULL,
    "sessiesPerWeekMin" INTEGER NOT NULL DEFAULT 2,
    "sessiesPerWeekMax" INTEGER NOT NULL DEFAULT 3,
    "minRustdagen" INTEGER NOT NULL DEFAULT 0,
    "opwarmen" TEXT NOT NULL DEFAULT '',
    "introWeken" INTEGER NOT NULL DEFAULT 0,
    "introSets" INTEGER,
    "introRir" INTEGER,
    "deloadElkeWeken" INTEGER,
    "deloadSetFactor" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "deloadTot" DATE,
    "bron" JSONB,
    "aangemaaktOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Programma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Programma_sleutel_key" ON "Programma"("sleutel");

-- Het bestaande schema A/B (alleen als er al schema's zijn).
INSERT INTO "Programma" ("id", "sleutel", "naam", "actief", "startdatum")
SELECT 'full-body-ab', 'full_body_ab_v0', 'Full body A/B', true, CURRENT_DATE
WHERE EXISTS (SELECT 1 FROM "Schema");

-- AlterTable
ALTER TABLE "Schema" ADD COLUMN     "code" TEXT,
ADD COLUMN     "focus" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "minuten" INTEGER,
ADD COLUMN     "inRotatie" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "programmaId" TEXT;

UPDATE "Schema" SET "code" = "id", "programmaId" = 'full-body-ab';

ALTER TABLE "Schema" ALTER COLUMN "code" SET NOT NULL,
ALTER COLUMN "programmaId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Schema_programmaId_code_key" ON "Schema"("programmaId", "code");

-- AddForeignKey
ALTER TABLE "Schema" ADD CONSTRAINT "Schema_programmaId_fkey" FOREIGN KEY ("programmaId") REFERENCES "Programma"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Oefening" ADD COLUMN     "alternatieven" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "knieGevoelig" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mechaniek" TEXT,
ADD COLUMN     "sleutel" TEXT,
ADD COLUMN     "spierenPrimair" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "spierenSecundair" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "unilateraal" BOOLEAN NOT NULL DEFAULT false;

-- Oefeningen uit het startschema van fase 1 → de sleutels uit benen-push-pull.json.
UPDATE "Oefening" SET "sleutel" = CASE "naam"
    WHEN 'Goblet squat' THEN 'goblet_squat'
    WHEN 'DB bench press' THEN 'db_bench_press'
    WHEN 'Cable row' THEN 'seated_cable_row'
    WHEN 'Romanian deadlift' THEN 'romanian_deadlift'
    WHEN 'DB shoulder press' THEN 'seated_db_shoulder_press'
    WHEN 'Calf raises' THEN 'standing_calf_raise'
    WHEN 'Dead bug' THEN 'dead_bug'
    WHEN 'Trap bar deadlift' THEN 'trap_bar_deadlift'
    WHEN 'Incline DB press' THEN 'incline_db_press'
    WHEN 'Lat pulldown' THEN 'lat_pulldown'
    WHEN 'Bulgarian split squat' THEN 'bulgarian_split_squat'
    WHEN 'Leg curl' THEN 'seated_leg_curl'
    WHEN 'Lateral raises' THEN 'lateral_raise'
    WHEN 'Triceps pushdown' THEN 'triceps_pushdown'
    ELSE NULL
END;

-- Alle andere: een sleutel uit de naam ("Leg press" → leg_press).
UPDATE "Oefening"
SET "sleutel" = trim(both '_' from lower(regexp_replace("naam", '[^a-zA-Z0-9]+', '_', 'g')))
WHERE "sleutel" IS NULL;

-- Zelfde sleutel twee keer (bijv. "Leg press" en "Leg-press"): de nieuwste krijgt het id erachter.
UPDATE "Oefening" o
SET "sleutel" = o."sleutel" || '_' || o."id"
WHERE EXISTS (
    SELECT 1 FROM "Oefening" p
    WHERE p."sleutel" = o."sleutel"
      AND (p."aangemaaktOp", p."id") < (o."aangemaaktOp", o."id")
);

ALTER TABLE "Oefening" ALTER COLUMN "sleutel" SET NOT NULL;

-- Kniebelastende oefeningen uit fase 1: daar blijft de kniepijnregel gelden.
UPDATE "Oefening" SET "knieGevoelig" = true
WHERE "sleutel" IN ('goblet_squat', 'bulgarian_split_squat', 'trap_bar_deadlift');

-- CreateIndex
CREATE UNIQUE INDEX "Oefening_sleutel_key" ON "Oefening"("sleutel");

-- AlterTable
ALTER TABLE "SchemaOefening" ADD COLUMN     "cue" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "doelRir" INTEGER,
ADD COLUMN     "rustSeconden" INTEGER;

-- AlterTable
ALTER TABLE "Training" ADD COLUMN     "fase" TEXT NOT NULL DEFAULT 'normaal',
ADD COLUMN     "week" INTEGER;

-- AlterTable
ALTER TABLE "TrainingOefening" ADD COLUMN     "cue" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "doelRir" INTEGER,
ADD COLUMN     "origineleOefeningId" TEXT,
ADD COLUMN     "rustSeconden" INTEGER;
