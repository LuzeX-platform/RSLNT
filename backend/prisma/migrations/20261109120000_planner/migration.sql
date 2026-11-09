-- AlterTable
ALTER TABLE "Gebruiker" ADD COLUMN     "agenda_token_hash" TEXT;

-- CreateTable
CREATE TABLE "Planning" (
    "gebruikerId" TEXT NOT NULL,
    "weekdag" INTEGER NOT NULL,
    "schemaId" TEXT NOT NULL,
    "tijd" TEXT NOT NULL DEFAULT '18:00',

    CONSTRAINT "Planning_pkey" PRIMARY KEY ("gebruikerId","weekdag")
);

-- CreateIndex
CREATE INDEX "Planning_schemaId_idx" ON "Planning"("schemaId");

-- CreateIndex
CREATE UNIQUE INDEX "Gebruiker_agenda_token_hash_key" ON "Gebruiker"("agenda_token_hash");

-- AddForeignKey
ALTER TABLE "Planning" ADD CONSTRAINT "Planning_gebruikerId_fkey" FOREIGN KEY ("gebruikerId") REFERENCES "Gebruiker"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Planning" ADD CONSTRAINT "Planning_schemaId_fkey" FOREIGN KEY ("schemaId") REFERENCES "Schema"("id") ON DELETE CASCADE ON UPDATE CASCADE;

