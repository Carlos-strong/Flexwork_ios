-- Galerie de photos des services (2026-11-08) : jusqu'à 3 photos par Gig, la première servant
-- de couverture. L'image unique existante devient la première photo de la galerie, puis la
-- colonne `coverImagePath` disparaît (une seule source de vérité).
ALTER TABLE "Gig" ADD COLUMN "imagePaths" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "Gig" SET "imagePaths" = ARRAY["coverImagePath"] WHERE "coverImagePath" IS NOT NULL;
ALTER TABLE "Gig" DROP COLUMN "coverImagePath";
