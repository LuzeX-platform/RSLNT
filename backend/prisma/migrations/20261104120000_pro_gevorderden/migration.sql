-- Pro voor gevorderden: progressieregels, technieken, blokken, lichte dag, duurtraining,
-- pijnlogboek en deellinks. Alles met een standaardwaarde, dus bestaande rijen blijven geldig.
ALTER TABLE "Programma" ADD COLUMN "periodisering" JSONB;
ALTER TABLE "SchemaOefening" ADD COLUMN "progressie" TEXT NOT NULL DEFAULT 'dubbel', ADD COLUMN "techniek" TEXT;
ALTER TABLE "Training" ADD COLUMN "blok" TEXT;
ALTER TABLE "TrainingOefening" ADD COLUMN "progressie" TEXT NOT NULL DEFAULT 'dubbel', ADD COLUMN "techniek" TEXT;
ALTER TABLE "TrainingSet" ADD COLUMN "soort" TEXT NOT NULL DEFAULT 'normaal';

CREATE TABLE "Duurtraining" (
    "id" TEXT NOT NULL,
    "gebruikerId" TEXT NOT NULL,
    "datum" DATE NOT NULL,
    "soort" TEXT NOT NULL,
    "minuten" INTEGER NOT NULL,
    "afstandMeter" INTEGER,
    "intensiteit" TEXT NOT NULL,
    "notitie" TEXT NOT NULL DEFAULT '',
    "aangemaaktOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Duurtraining_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Duurtraining_gebruikerId_datum_idx" ON "Duurtraining"("gebruikerId", "datum");
ALTER TABLE "Duurtraining" ADD CONSTRAINT "Duurtraining_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Pijnnotitie" (
    "id" TEXT NOT NULL,
    "gebruikerId" TEXT NOT NULL,
    "datum" DATE NOT NULL,
    "plek" TEXT NOT NULL,
    "ernst" INTEGER NOT NULL,
    "notitie" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'actief',
    "herstelOp" DATE,
    "aangemaaktOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Pijnnotitie_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Pijnnotitie_gebruikerId_datum_idx" ON "Pijnnotitie"("gebruikerId", "datum");
ALTER TABLE "Pijnnotitie" ADD CONSTRAINT "Pijnnotitie_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Deellink" (
    "id" TEXT NOT NULL,
    "gebruikerId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "naam" TEXT NOT NULL,
    "onderdelen" TEXT[],
    "verlooptOp" TIMESTAMP(3) NOT NULL,
    "ingetrokkenOp" TIMESTAMP(3),
    "laatstBekekenOp" TIMESTAMP(3),
    "aangemaaktOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Deellink_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Deellink_tokenHash_key" ON "Deellink"("tokenHash");
CREATE INDEX "Deellink_gebruikerId_idx" ON "Deellink"("gebruikerId");
ALTER TABLE "Deellink" ADD CONSTRAINT "Deellink_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
