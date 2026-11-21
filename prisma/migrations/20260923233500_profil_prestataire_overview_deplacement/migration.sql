-- Champs du formulaire prestataire alignés sur le modèle (2026-09-23).
-- Voir les commentaires du modèle Profile pour le pourquoi de chaque champ.
ALTER TABLE "Profile" ADD COLUMN "overview" TEXT;
ALTER TABLE "Profile" ADD COLUMN "quartier" TEXT;
ALTER TABLE "Profile" ADD COLUMN "deplacement" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Profile" ADD COLUMN "modeContact" TEXT;
-- Alignement sur les listes existantes (`coverageZones`, `offeredServices`, `tags`) : ce sont
-- des colonnes NULLABLES sans valeur par défaut. Créer `deplacement` en NOT NULL DEFAULT '{}'
-- aurait suffi à la faire dériver du reste, et `prisma migrate` aurait proposé de la corriger
-- plus tard, pour rien.
ALTER TABLE "Profile" ALTER COLUMN "deplacement" DROP NOT NULL;
ALTER TABLE "Profile" ALTER COLUMN "deplacement" DROP DEFAULT;
