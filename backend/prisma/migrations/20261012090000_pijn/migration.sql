-- Kniepijn wordt pijn met een plek: per set (0–10) en in de herstelcheck (1–5). Wat er al
-- gelogd is, was kniepijn; dat blijft zo staan, met plek "knie".

ALTER TABLE "TrainingSet" RENAME COLUMN "kniepijn" TO "pijn";
ALTER TABLE "TrainingSet" ADD COLUMN "pijnPlek" TEXT;
UPDATE "TrainingSet" SET "pijnPlek" = 'knie' WHERE "pijn" IS NOT NULL;

ALTER TABLE "Herstelcheck" RENAME COLUMN "kniepijn" TO "pijn";
ALTER TABLE "Herstelcheck" ADD COLUMN "pijnPlekken" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "Herstelcheck" SET "pijnPlekken" = ARRAY['knie'] WHERE "pijn" >= 2;
