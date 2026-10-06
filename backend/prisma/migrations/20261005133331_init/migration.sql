-- CreateTable
CREATE TABLE "Gebruiker" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "naam" TEXT NOT NULL,
    "wachtwoordHash" TEXT NOT NULL,
    "mislukteInlogpogingen" INTEGER NOT NULL DEFAULT 0,
    "vergrendeldTot" TIMESTAMP(3),
    "aangemaaktOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Gebruiker_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Oefening" (
    "id" TEXT NOT NULL,
    "naam" TEXT NOT NULL,
    "materiaal" TEXT NOT NULL,
    "gewichtsstap" DOUBLE PRECISION NOT NULL,
    "perKant" BOOLEAN NOT NULL DEFAULT false,
    "aangemaaktOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Oefening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Schema" (
    "id" TEXT NOT NULL,
    "naam" TEXT NOT NULL,
    "volgorde" INTEGER NOT NULL,

    CONSTRAINT "Schema_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchemaOefening" (
    "id" TEXT NOT NULL,
    "schemaId" TEXT NOT NULL,
    "oefeningId" TEXT NOT NULL,
    "volgorde" INTEGER NOT NULL,
    "aantalSets" INTEGER NOT NULL,
    "minSets" INTEGER NOT NULL,
    "repsMin" INTEGER NOT NULL,
    "repsMax" INTEGER NOT NULL,
    "supersetGroep" TEXT,

    CONSTRAINT "SchemaOefening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Training" (
    "id" TEXT NOT NULL,
    "schemaId" TEXT NOT NULL,
    "datum" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notitie" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'bezig',
    "afgerondOp" TIMESTAMP(3),
    "aangemaaktOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Training_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingOefening" (
    "id" TEXT NOT NULL,
    "trainingId" TEXT NOT NULL,
    "oefeningId" TEXT NOT NULL,
    "volgorde" INTEGER NOT NULL,
    "aantalSets" INTEGER NOT NULL,
    "minSets" INTEGER NOT NULL,
    "repsMin" INTEGER NOT NULL,
    "repsMax" INTEGER NOT NULL,
    "supersetGroep" TEXT,

    CONSTRAINT "TrainingOefening_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrainingSet" (
    "id" TEXT NOT NULL,
    "trainingOefeningId" TEXT NOT NULL,
    "nummer" INTEGER NOT NULL,
    "gewicht" DOUBLE PRECISION,
    "reps" INTEGER NOT NULL,
    "rir" INTEGER,
    "kniepijn" INTEGER,
    "opgeslagenOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrainingSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lichaamsgewicht" (
    "datum" DATE NOT NULL,
    "gewicht" DOUBLE PRECISION NOT NULL,
    "opgeslagenOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lichaamsgewicht_pkey" PRIMARY KEY ("datum")
);

-- CreateIndex
CREATE UNIQUE INDEX "Gebruiker_email_key" ON "Gebruiker"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Oefening_naam_key" ON "Oefening"("naam");

-- CreateIndex
CREATE INDEX "SchemaOefening_schemaId_volgorde_idx" ON "SchemaOefening"("schemaId", "volgorde");

-- CreateIndex
CREATE INDEX "Training_datum_idx" ON "Training"("datum");

-- CreateIndex
CREATE INDEX "TrainingOefening_oefeningId_idx" ON "TrainingOefening"("oefeningId");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingSet_trainingOefeningId_nummer_key" ON "TrainingSet"("trainingOefeningId", "nummer");

-- AddForeignKey
ALTER TABLE "SchemaOefening" ADD CONSTRAINT "SchemaOefening_schemaId_fkey" FOREIGN KEY ("schemaId") REFERENCES "Schema"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchemaOefening" ADD CONSTRAINT "SchemaOefening_oefeningId_fkey" FOREIGN KEY ("oefeningId") REFERENCES "Oefening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Training" ADD CONSTRAINT "Training_schemaId_fkey" FOREIGN KEY ("schemaId") REFERENCES "Schema"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingOefening" ADD CONSTRAINT "TrainingOefening_trainingId_fkey" FOREIGN KEY ("trainingId") REFERENCES "Training"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingOefening" ADD CONSTRAINT "TrainingOefening_oefeningId_fkey" FOREIGN KEY ("oefeningId") REFERENCES "Oefening"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrainingSet" ADD CONSTRAINT "TrainingSet_trainingOefeningId_fkey" FOREIGN KEY ("trainingOefeningId") REFERENCES "TrainingOefening"("id") ON DELETE CASCADE ON UPDATE CASCADE;
