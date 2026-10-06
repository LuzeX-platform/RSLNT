-- Accounts voor meer mensen. Tot nu toe hing de data aan niemand (er was één gebruiker); vanaf nu
-- hoort alles bij een account. Bestaande data gaat naar het oudste account: de eigenaar uit de seed.

-- ---------- 1. Gebruiker: bevestiging, reset, toestemming, rol, sessieversie ----------
ALTER TABLE "Gebruiker" ADD COLUMN "bevestigTokenHash" TEXT,
ADD COLUMN "bijgewerktOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "emailBevestigdOp" TIMESTAMP(3),
ADD COLUMN "privacyVersie" TEXT,
ADD COLUMN "resetTokenHash" TEXT,
ADD COLUMN "resetTokenVerlooptOp" TIMESTAMP(3),
ADD COLUMN "rol" TEXT NOT NULL DEFAULT 'lid',
ADD COLUMN "sessieVersie" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "toestemmingOp" TIMESTAMP(3);

CREATE UNIQUE INDEX "Gebruiker_bevestigTokenHash_key" ON "Gebruiker"("bevestigTokenHash");
CREATE UNIQUE INDEX "Gebruiker_resetTokenHash_key" ON "Gebruiker"("resetTokenHash");

-- Bestaande accounts zijn van vóór de registratie en gelden als bevestigd. Het oudste is de
-- eigenaar (admin); die beheert de gegevens zelf, dus we leggen ook de toestemming vast.
UPDATE "Gebruiker" SET "emailBevestigdOp" = "aangemaaktOp", "toestemmingOp" = "aangemaaktOp";
UPDATE "Gebruiker" SET "rol" = 'admin' WHERE "id" = (SELECT "id" FROM "Gebruiker" ORDER BY "aangemaaktOp", "id" LIMIT 1);

-- ---------- 2. Een eigenaar op alle data ----------
ALTER TABLE "Oefening" ADD COLUMN "gebruikerId" TEXT;
UPDATE "Oefening" SET "gebruikerId" = (SELECT "id" FROM "Gebruiker" ORDER BY "aangemaaktOp", "id" LIMIT 1);
ALTER TABLE "Oefening" ALTER COLUMN "gebruikerId" SET NOT NULL;

DROP INDEX "Oefening_naam_key";
DROP INDEX "Oefening_sleutel_key";
CREATE UNIQUE INDEX "Oefening_gebruikerId_sleutel_key" ON "Oefening"("gebruikerId", "sleutel");
CREATE UNIQUE INDEX "Oefening_gebruikerId_naam_key" ON "Oefening"("gebruikerId", "naam");

ALTER TABLE "Programma" ADD COLUMN "gebruikerId" TEXT;
UPDATE "Programma" SET "gebruikerId" = (SELECT "id" FROM "Gebruiker" ORDER BY "aangemaaktOp", "id" LIMIT 1);
ALTER TABLE "Programma" ALTER COLUMN "gebruikerId" SET NOT NULL;

DROP INDEX "Programma_sleutel_key";
CREATE UNIQUE INDEX "Programma_gebruikerId_sleutel_key" ON "Programma"("gebruikerId", "sleutel");
CREATE INDEX "Programma_gebruikerId_actief_idx" ON "Programma"("gebruikerId", "actief");

ALTER TABLE "Training" ADD COLUMN "gebruikerId" TEXT;
UPDATE "Training" SET "gebruikerId" = (SELECT "id" FROM "Gebruiker" ORDER BY "aangemaaktOp", "id" LIMIT 1);
ALTER TABLE "Training" ALTER COLUMN "gebruikerId" SET NOT NULL;

DROP INDEX "Training_datum_idx";
CREATE INDEX "Training_gebruikerId_datum_idx" ON "Training"("gebruikerId", "datum");

-- Per dag één weging, meting en herstelcheck: nu per account.
ALTER TABLE "Lichaamsgewicht" ADD COLUMN "gebruikerId" TEXT;
UPDATE "Lichaamsgewicht" SET "gebruikerId" = (SELECT "id" FROM "Gebruiker" ORDER BY "aangemaaktOp", "id" LIMIT 1);
ALTER TABLE "Lichaamsgewicht" ALTER COLUMN "gebruikerId" SET NOT NULL;
ALTER TABLE "Lichaamsgewicht" DROP CONSTRAINT "Lichaamsgewicht_pkey",
ADD CONSTRAINT "Lichaamsgewicht_pkey" PRIMARY KEY ("gebruikerId", "datum");

ALTER TABLE "Lichaamsmeting" ADD COLUMN "gebruikerId" TEXT;
UPDATE "Lichaamsmeting" SET "gebruikerId" = (SELECT "id" FROM "Gebruiker" ORDER BY "aangemaaktOp", "id" LIMIT 1);
ALTER TABLE "Lichaamsmeting" ALTER COLUMN "gebruikerId" SET NOT NULL;
ALTER TABLE "Lichaamsmeting" DROP CONSTRAINT "Lichaamsmeting_pkey",
ADD CONSTRAINT "Lichaamsmeting_pkey" PRIMARY KEY ("gebruikerId", "datum");

ALTER TABLE "Herstelcheck" ADD COLUMN "gebruikerId" TEXT;
UPDATE "Herstelcheck" SET "gebruikerId" = (SELECT "id" FROM "Gebruiker" ORDER BY "aangemaaktOp", "id" LIMIT 1);
ALTER TABLE "Herstelcheck" ALTER COLUMN "gebruikerId" SET NOT NULL;
ALTER TABLE "Herstelcheck" DROP CONSTRAINT "Herstelcheck_pkey",
ADD CONSTRAINT "Herstelcheck_pkey" PRIMARY KEY ("gebruikerId", "datum");

-- Profiel en voorkeuren waren één rij ("ik"); nu één rij per account, met het account als sleutel.
ALTER TABLE "Profiel" ADD COLUMN "gebruikerId" TEXT;
UPDATE "Profiel" SET "gebruikerId" = (SELECT "id" FROM "Gebruiker" ORDER BY "aangemaaktOp", "id" LIMIT 1);
ALTER TABLE "Profiel" ALTER COLUMN "gebruikerId" SET NOT NULL;
ALTER TABLE "Profiel" DROP CONSTRAINT "Profiel_pkey",
DROP COLUMN "id",
ADD CONSTRAINT "Profiel_pkey" PRIMARY KEY ("gebruikerId");

ALTER TABLE "Voorkeuren" ADD COLUMN "gebruikerId" TEXT;
UPDATE "Voorkeuren" SET "gebruikerId" = (SELECT "id" FROM "Gebruiker" ORDER BY "aangemaaktOp", "id" LIMIT 1);
ALTER TABLE "Voorkeuren" ALTER COLUMN "gebruikerId" SET NOT NULL;
ALTER TABLE "Voorkeuren" DROP CONSTRAINT "Voorkeuren_pkey",
DROP COLUMN "id",
ADD CONSTRAINT "Voorkeuren_pkey" PRIMARY KEY ("gebruikerId");

-- ---------- 3. Verwijder je account, dan gaat alles mee ----------
ALTER TABLE "Oefening" ADD CONSTRAINT "Oefening_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Programma" ADD CONSTRAINT "Programma_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Training" ADD CONSTRAINT "Training_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lichaamsgewicht" ADD CONSTRAINT "Lichaamsgewicht_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Profiel" ADD CONSTRAINT "Profiel_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Voorkeuren" ADD CONSTRAINT "Voorkeuren_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Lichaamsmeting" ADD CONSTRAINT "Lichaamsmeting_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Herstelcheck" ADD CONSTRAINT "Herstelcheck_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;
