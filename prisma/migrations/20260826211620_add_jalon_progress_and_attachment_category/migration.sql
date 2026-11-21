-- AlterTable
ALTER TABLE "Jalon" ADD COLUMN     "declaredProgress" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "observedProgress" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "MissionAttachment" ADD COLUMN     "category" TEXT,
ADD COLUMN     "note" TEXT;
