-- AlterTable
ALTER TABLE "Mission" ADD COLUMN     "declaredProgress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "observedProgress" INTEGER NOT NULL DEFAULT 0;
