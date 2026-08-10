-- CreateEnum
CREATE TYPE "JalonStatus" AS ENUM ('en_attente', 'fonds_sous_sequestre', 'livrable_soumis', 'valide', 'rejete', 'libere');

-- AlterTable
ALTER TABLE "MissionAttachment" ADD COLUMN     "jalonId" TEXT;

-- AlterTable
ALTER TABLE "PspEscrowOperation" ADD COLUMN     "jalonId" TEXT;

-- CreateTable
CREATE TABLE "Jalon" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "ordre" INTEGER NOT NULL,
    "titre" TEXT NOT NULL,
    "montant" DOUBLE PRECISION NOT NULL,
    "status" "JalonStatus" NOT NULL DEFAULT 'en_attente',
    "rejectionReason" TEXT,
    "revisionCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Jalon_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Jalon_contractId_status_idx" ON "Jalon"("contractId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Jalon_contractId_ordre_key" ON "Jalon"("contractId", "ordre");

-- CreateIndex
CREATE INDEX "MissionAttachment_jalonId_idx" ON "MissionAttachment"("jalonId");

-- CreateIndex
CREATE INDEX "PspEscrowOperation_jalonId_idx" ON "PspEscrowOperation"("jalonId");

-- AddForeignKey
ALTER TABLE "MissionAttachment" ADD CONSTRAINT "MissionAttachment_jalonId_fkey" FOREIGN KEY ("jalonId") REFERENCES "Jalon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Jalon" ADD CONSTRAINT "Jalon_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "PrestationContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PspEscrowOperation" ADD CONSTRAINT "PspEscrowOperation_jalonId_fkey" FOREIGN KEY ("jalonId") REFERENCES "Jalon"("id") ON DELETE CASCADE ON UPDATE CASCADE;
