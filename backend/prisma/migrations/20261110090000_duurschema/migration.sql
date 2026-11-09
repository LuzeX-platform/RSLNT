-- CreateTable
CREATE TABLE "Duurschema" (
    "gebruikerId" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "doel" TEXT NOT NULL,
    "afstand" DOUBLE PRECISION,
    "niveau" TEXT NOT NULL,
    "dagenPerWeek" INTEGER NOT NULL,
    "dagen" INTEGER[],
    "tijd" TEXT NOT NULL DEFAULT '07:30',
    "startdatum" DATE NOT NULL,
    "aangemaaktOp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Duurschema_pkey" PRIMARY KEY ("gebruikerId")
);

-- AddForeignKey
ALTER TABLE "Duurschema" ADD CONSTRAINT "Duurschema_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

