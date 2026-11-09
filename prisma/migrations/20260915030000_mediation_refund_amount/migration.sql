-- Répartition à trois destinations d'une résolution de médiation (§24) : libérer au prestataire,
-- rendre au client, maintenir bloqué. Seule la première existait.
ALTER TABLE "Mediation" ADD COLUMN "refundAmount" DOUBLE PRECISION;
