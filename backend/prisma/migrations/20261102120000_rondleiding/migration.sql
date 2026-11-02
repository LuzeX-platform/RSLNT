-- Wanneer iemand de rondleiding door de app heeft gezien; null = nog niet.

-- AlterTable
ALTER TABLE "Gebruiker" ADD COLUMN     "rondleiding_gezien_op" TIMESTAMP(3);
