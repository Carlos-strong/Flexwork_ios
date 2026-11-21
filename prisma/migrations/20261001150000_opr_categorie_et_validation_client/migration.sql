-- Vérification OPR : autorisation par catégorie, et trace de la validation définitive du client
-- (2026-10-01).
--
-- `allowsOprVerification` : le mode « OPR / responsable chantier » n'est proposé à la
-- publication que pour les catégories ainsi marquées. Aucune n'est marquée ici : comme pour la
-- barrière d'âge, c'est l'administrateur qui classe, jamais une déduction du secteur.
ALTER TABLE "categories" ADD COLUMN "allowsOprVerification" BOOLEAN NOT NULL DEFAULT false;

-- Qui a prononcé la validation définitive, et quand — distinct de la vérification du
-- responsable et de la confirmation PSP.
ALTER TABLE "Jalon"
  ADD COLUMN "clientValidatedById" TEXT,
  ADD COLUMN "clientValidatedAt" TIMESTAMP(3);

ALTER TABLE "Mission"
  ADD COLUMN "clientValidatedById" TEXT,
  ADD COLUMN "clientValidatedAt" TIMESTAMP(3);
