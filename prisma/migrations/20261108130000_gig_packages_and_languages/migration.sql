-- CreateEnum
CREATE TYPE "GigTier" AS ENUM ('basique', 'standard', 'premium');

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "languages" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Gig" ADD COLUMN     "coverImagePath" TEXT,
ADD COLUMN     "videoUrl" TEXT;

-- AlterTable
ALTER TABLE "GigOrder" ADD COLUMN     "packageTier" "GigTier";

-- CreateTable
CREATE TABLE "GigPackage" (
    "id" TEXT NOT NULL,
    "gigId" TEXT NOT NULL,
    "tier" "GigTier" NOT NULL,
    "titre" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "prix" DOUBLE PRECISION NOT NULL,
    "delaiJours" INTEGER NOT NULL,
    "revisions" INTEGER NOT NULL,

    CONSTRAINT "GigPackage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GigPackage_gigId_tier_key" ON "GigPackage"("gigId", "tier");

-- AddForeignKey
ALTER TABLE "GigPackage" ADD CONSTRAINT "GigPackage_gigId_fkey" FOREIGN KEY ("gigId") REFERENCES "Gig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

