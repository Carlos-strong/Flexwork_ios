-- CreateEnum
CREATE TYPE "FundingGranularity" AS ENUM ('per_jalon', 'upfront');

-- AlterTable : défaut = comportement historique, les contrats existants sont inchangés.
ALTER TABLE "PrestationContract" ADD COLUMN "fundingGranularity" "FundingGranularity" NOT NULL DEFAULT 'per_jalon';
