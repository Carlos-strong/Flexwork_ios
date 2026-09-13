-- CreateEnum
CREATE TYPE "FinancingMode" AS ENUM ('lump_sum', 'progressive');

-- AlterTable
ALTER TABLE "PrestationContract" ADD COLUMN     "financingMode" "FinancingMode" NOT NULL DEFAULT 'lump_sum',
ADD COLUMN     "jalonsSequential" BOOLEAN NOT NULL DEFAULT false;
