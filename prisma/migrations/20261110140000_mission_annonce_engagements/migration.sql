-- Annonce et engagements, durée de publication (2026-11-10).
ALTER TYPE "MissionStatus" ADD VALUE 'annonce_close';

ALTER TABLE "Mission" ADD COLUMN "dureePublicationJours" INTEGER,
ADD COLUMN "parentMissionId" TEXT;

CREATE INDEX "Mission_parentMissionId_idx" ON "Mission"("parentMissionId");

ALTER TABLE "Mission" ADD CONSTRAINT "Mission_parentMissionId_fkey" FOREIGN KEY ("parentMissionId") REFERENCES "Mission"("id") ON DELETE SET NULL ON UPDATE CASCADE;
