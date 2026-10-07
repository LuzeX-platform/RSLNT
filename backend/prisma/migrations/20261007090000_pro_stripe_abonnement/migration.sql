-- AlterTable
ALTER TABLE "Gebruiker" ADD COLUMN     "pro" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "stripe_abonnement_id" TEXT,
ADD COLUMN     "stripe_klant_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Gebruiker_stripe_klant_id_key" ON "Gebruiker"("stripe_klant_id");

-- CreateIndex
CREATE UNIQUE INDEX "Gebruiker_stripe_abonnement_id_key" ON "Gebruiker"("stripe_abonnement_id");
