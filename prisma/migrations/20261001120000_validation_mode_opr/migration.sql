-- Vérification / validation d'une mission : « Moi-même » ou « OPR / responsable chantier »
-- (2026-10-01).
--
-- En mode OPR, le responsable de chantier vérifie (relevés, preuves, avancement) et TRANSMET ;
-- le client prononce seul la validation définitive, donc la libération des fonds.
--
-- La désignation du responsable remonte de SpotTimeTerms (contrats au temps seulement) au
-- CONTRAT, pour couvrir aussi jalons et tâches. Les désignations existantes sont recopiées, et
-- ces contrats passent en "opr" : leurs clients avaient explicitement délégué le constat.
CREATE TYPE "ValidationMode" AS ENUM ('client', 'opr');

ALTER TYPE "AttendanceStatus" ADD VALUE 'verified';

-- Mission : mode choisi à la publication, responsable éventuellement désigné dès ce moment,
-- transmission au niveau mission entière (contrat sans jalon).
ALTER TABLE "Mission"
  ADD COLUMN "validationMode" "ValidationMode" NOT NULL DEFAULT 'client',
  ADD COLUMN "siteManagerId" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedById" TEXT,
  ADD COLUMN "verificationNote" TEXT;

ALTER TABLE "Mission" ADD CONSTRAINT "Mission_siteManagerId_fkey"
  FOREIGN KEY ("siteManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Contrat : mode figé + responsable désigné.
ALTER TABLE "PrestationContract"
  ADD COLUMN "validationMode" "ValidationMode" NOT NULL DEFAULT 'client',
  ADD COLUMN "siteManagerId" TEXT;

ALTER TABLE "PrestationContract" ADD CONSTRAINT "PrestationContract_siteManagerId_fkey"
  FOREIGN KEY ("siteManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "PrestationContract_siteManagerId_idx" ON "PrestationContract"("siteManagerId");

-- Reprise des désignations existantes AVANT de retirer l'ancienne colonne.
UPDATE "PrestationContract" c
SET "siteManagerId" = t."siteManagerId", "validationMode" = 'opr'
FROM "SpotTimeTerms" t
WHERE t."contractId" = c."id" AND t."siteManagerId" IS NOT NULL;

UPDATE "Mission" m
SET "validationMode" = 'opr', "siteManagerId" = c."siteManagerId"
FROM "PrestationContract" c
WHERE c."missionId" = m."id" AND c."validationMode" = 'opr';

ALTER TABLE "SpotTimeTerms" DROP CONSTRAINT "SpotTimeTerms_siteManagerId_fkey";
DROP INDEX "SpotTimeTerms_siteManagerId_idx";
ALTER TABLE "SpotTimeTerms" DROP COLUMN "siteManagerId";

-- Jalon : transmission du responsable au client.
ALTER TABLE "Jalon"
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "verifiedById" TEXT,
  ADD COLUMN "verificationNote" TEXT;

-- Relevé de présence : constat du responsable, en attente du client.
ALTER TABLE "Attendance"
  ADD COLUMN "verifiedQuantity" DOUBLE PRECISION,
  ADD COLUMN "verifiedOvertimeQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "verifiedById" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3);
