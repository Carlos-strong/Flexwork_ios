-- Conditions d'un contrat au temps (S2), posées à la publication puis négociées à la candidature.
-- Additif et nullable : aucune mission ni candidature existante n'est concernée.
ALTER TABLE "Mission" ADD COLUMN "timeRate" DOUBLE PRECISION;
ALTER TABLE "Mission" ADD COLUMN "timeMaxQuantity" DOUBLE PRECISION;
ALTER TABLE "MissionProposal" ADD COLUMN "unitRate" DOUBLE PRECISION;
