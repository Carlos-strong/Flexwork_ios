-- AlterTable
ALTER TABLE "MissionAttachment" ADD COLUMN     "appreciatedAt" TIMESTAMP(3),
ADD COLUMN     "appreciatedById" TEXT,
ADD COLUMN     "appreciation" TEXT,
ADD COLUMN     "rejectionMotif" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "requestNewProof" BOOLEAN NOT NULL DEFAULT false;
