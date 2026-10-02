-- CreateEnum
CREATE TYPE "BadgeStatus" AS ENUM ('non_demande', 'en_attente', 'accorde', 'refuse');

-- AlterEnum
ALTER TYPE "DeclarationType" ADD VALUE 'experience';

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "badgeDecidedAt" TIMESTAMP(3),
ADD COLUMN     "badgeRefusalReason" TEXT,
ADD COLUMN     "badgeRequestedAt" TIMESTAMP(3),
ADD COLUMN     "badgeStatus" "BadgeStatus" NOT NULL DEFAULT 'non_demande';

-- CreateTable
CREATE TABLE "DeclaredDiploma" (
    "id" TEXT NOT NULL,
    "declarationId" TEXT NOT NULL,
    "qualificationName" TEXT NOT NULL,
    "year" INTEGER,
    "location" TEXT,
    "institution" TEXT,
    "specialty" TEXT,
    "isStateIssued" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclaredDiploma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeclaredExperience" (
    "id" TEXT NOT NULL,
    "declarationId" TEXT NOT NULL,
    "clientType" TEXT NOT NULL,
    "clientName" TEXT,
    "role" TEXT NOT NULL,
    "domain" TEXT,
    "description" TEXT,
    "startDate" TEXT,
    "endDate" TEXT,
    "technologies" TEXT,
    "projectUrl" TEXT,
    "livrables" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclaredExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeclaredReference" (
    "id" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "nom" TEXT NOT NULL,
    "prenom" TEXT,
    "tel" TEXT,
    "email" TEXT,
    "lien" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclaredReference_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeclaredDiploma_declarationId_idx" ON "DeclaredDiploma"("declarationId");

-- CreateIndex
CREATE INDEX "DeclaredExperience_declarationId_idx" ON "DeclaredExperience"("declarationId");

-- CreateIndex
CREATE INDEX "DeclaredReference_experienceId_idx" ON "DeclaredReference"("experienceId");

-- AddForeignKey
ALTER TABLE "DeclaredDiploma" ADD CONSTRAINT "DeclaredDiploma_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "ProfessionalDeclaration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeclaredExperience" ADD CONSTRAINT "DeclaredExperience_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "ProfessionalDeclaration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeclaredReference" ADD CONSTRAINT "DeclaredReference_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "DeclaredExperience"("id") ON DELETE CASCADE ON UPDATE CASCADE;
