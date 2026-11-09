-- Rôle responsable chantier et sa désignation contrat par contrat.
-- Additive : aucun compte ni contrat existant n'est modifié.

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'responsable_chantier';

-- AlterTable
ALTER TABLE "SpotTimeTerms" ADD COLUMN "siteManagerId" TEXT;

-- CreateIndex
CREATE INDEX "SpotTimeTerms_siteManagerId_idx" ON "SpotTimeTerms"("siteManagerId");

-- AddForeignKey
ALTER TABLE "SpotTimeTerms" ADD CONSTRAINT "SpotTimeTerms_siteManagerId_fkey" FOREIGN KEY ("siteManagerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
