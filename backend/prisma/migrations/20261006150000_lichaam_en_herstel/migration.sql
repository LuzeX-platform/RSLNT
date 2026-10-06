-- Fase 2: profiel, lichaamsmetingen en herstelcheck. Alleen nieuwe tabellen; bestaande data blijft ongemoeid.

-- CreateTable
CREATE TABLE "Profiel" (
    "id" TEXT NOT NULL DEFAULT 'ik',
    "geboortedatum" DATE,
    "geslacht" TEXT,
    "lengteCm" DOUBLE PRECISION,
    "activiteit" TEXT NOT NULL DEFAULT 'licht',
    "doelgewicht" DOUBLE PRECISION,
    "tempoMin" DOUBLE PRECISION,
    "tempoMax" DOUBLE PRECISION,
    "bijgewerktOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Profiel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lichaamsmeting" (
    "datum" DATE NOT NULL,
    "vetpercentage" DOUBLE PRECISION,
    "tailleCm" DOUBLE PRECISION,
    "nekCm" DOUBLE PRECISION,
    "heupCm" DOUBLE PRECISION,
    "armCm" DOUBLE PRECISION,
    "borstCm" DOUBLE PRECISION,
    "dijCm" DOUBLE PRECISION,
    "opgeslagenOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Lichaamsmeting_pkey" PRIMARY KEY ("datum")
);

-- CreateTable
CREATE TABLE "Herstelcheck" (
    "datum" DATE NOT NULL,
    "slaap" INTEGER NOT NULL,
    "spierpijn" INTEGER NOT NULL,
    "energie" INTEGER NOT NULL,
    "kniepijn" INTEGER NOT NULL,
    "opgeslagenOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Herstelcheck_pkey" PRIMARY KEY ("datum")
);

