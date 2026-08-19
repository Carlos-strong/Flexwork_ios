/*
  Warnings:

  - A unique constraint covering the columns `[userId,label]` on the table `Profile` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `MissionProposal` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('brouillon', 'envoyee', 'acceptee', 'refusee', 'expiree', 'annulee');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ProposalStatus" ADD VALUE 'preselectionnee';
ALTER TYPE "ProposalStatus" ADD VALUE 'en_negociation';
ALTER TYPE "ProposalStatus" ADD VALUE 'devis_valide';
ALTER TYPE "ProposalStatus" ADD VALUE 'annulee_definitive';

-- DropIndex
DROP INDEX "Profile_userId_key";

-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "dateExpiration" TIMESTAMP(3),
ADD COLUMN     "maxRevisionRounds" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "tvaRate" DOUBLE PRECISION DEFAULT 0;

-- AlterTable
ALTER TABLE "MissionProposal" ADD COLUMN     "devisData" JSONB,
ADD COLUMN     "devisValideAt" TIMESTAMP(3),
ADD COLUMN     "roundActuel" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "montant" SET DEFAULT 0;

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "isDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "label" TEXT NOT NULL DEFAULT 'Principal';

-- CreateTable
CREATE TABLE "DevisRevision" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "authorId" TEXT NOT NULL,
    "devisData" JSONB NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DevisRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "proposalId" TEXT,
    "titre" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "montant" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "milestones" JSONB,
    "status" "OfferStatus" NOT NULL DEFAULT 'brouillon',
    "sentAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "declinedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DevisRevision_proposalId_roundNumber_idx" ON "DevisRevision"("proposalId", "roundNumber");

-- CreateIndex
CREATE INDEX "Offer_providerId_status_idx" ON "Offer"("providerId", "status");

-- CreateIndex
CREATE INDEX "Offer_missionId_idx" ON "Offer"("missionId");

-- CreateIndex
CREATE INDEX "MissionProposal_providerId_status_idx" ON "MissionProposal"("providerId", "status");

-- CreateIndex
CREATE INDEX "Profile_userId_idx" ON "Profile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_label_key" ON "Profile"("userId", "label");

-- AddForeignKey
ALTER TABLE "DevisRevision" ADD CONSTRAINT "DevisRevision_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "MissionProposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DevisRevision" ADD CONSTRAINT "DevisRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "MissionProposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
