-- Désistement / retrait d'un prestataire retenu (2026-11-11) : l'engagement passe à `annulee`
-- et sa place se libère sur l'annonce.
ALTER TYPE "MissionStatus" ADD VALUE 'annulee';

ALTER TABLE "Mission" ADD COLUMN "annuleeAt" TIMESTAMP(3),
ADD COLUMN "annulationMotif" TEXT,
ADD COLUMN "annuleePar" VARCHAR(20);
