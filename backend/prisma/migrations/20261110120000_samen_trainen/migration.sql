-- CreateTable
CREATE TABLE "SamenSessie" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "gastheerId" TEXT NOT NULL,
    "schemaId" TEXT NOT NULL,
    "naam" TEXT NOT NULL,
    "minuten" INTEGER,
    "oefeningen" JSONB NOT NULL,
    "geldigTot" TIMESTAMP(3) NOT NULL,
    "aangemaaktOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SamenSessie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SamenDeelnemer" (
    "id" TEXT NOT NULL,
    "sessieId" TEXT NOT NULL,
    "gebruikerId" TEXT NOT NULL,
    "trainingId" TEXT,
    "aangemaaktOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SamenDeelnemer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SamenSessie_code_key" ON "SamenSessie"("code");

-- CreateIndex
CREATE INDEX "SamenSessie_gastheerId_idx" ON "SamenSessie"("gastheerId");

-- CreateIndex
CREATE INDEX "SamenDeelnemer_gebruikerId_idx" ON "SamenDeelnemer"("gebruikerId");

-- CreateIndex
CREATE INDEX "SamenDeelnemer_trainingId_idx" ON "SamenDeelnemer"("trainingId");

-- CreateIndex
CREATE UNIQUE INDEX "SamenDeelnemer_sessieId_gebruikerId_key" ON "SamenDeelnemer"("sessieId", "gebruikerId");

-- AddForeignKey
ALTER TABLE "SamenSessie" ADD CONSTRAINT "SamenSessie_gastheerId_fkey" FOREIGN KEY ("gastheerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamenDeelnemer" ADD CONSTRAINT "SamenDeelnemer_sessieId_fkey" FOREIGN KEY ("sessieId") REFERENCES "SamenSessie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SamenDeelnemer" ADD CONSTRAINT "SamenDeelnemer_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

