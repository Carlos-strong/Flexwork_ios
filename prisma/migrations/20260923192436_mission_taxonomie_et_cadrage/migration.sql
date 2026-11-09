-- CreateEnum
CREATE TYPE "MaterielFourniture" AS ENUM ('client', 'prestataire', 'mixte');

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "budgetMax" INTEGER,
ADD COLUMN     "budgetMin" INTEGER,
ADD COLUMN     "cahierDesCharges" TEXT,
ADD COLUMN     "categorieId" TEXT,
ADD COLUMN     "dateDebut" TIMESTAMP(3),
ADD COLUMN     "materiel" "MaterielFourniture",
ADD COLUMN     "maxCandidatures" INTEGER,
ADD COLUMN     "metierId" TEXT,
ADD COLUMN     "pays" TEXT,
ADD COLUMN     "quartier" TEXT,
ADD COLUMN     "urgent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ville" TEXT;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_categorieId_fkey" FOREIGN KEY ("categorieId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_metierId_fkey" FOREIGN KEY ("metierId") REFERENCES "metiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
