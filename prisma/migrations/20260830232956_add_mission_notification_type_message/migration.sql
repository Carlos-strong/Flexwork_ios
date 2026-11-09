-- AlterTable
ALTER TABLE "MissionNotification" ADD COLUMN     "message" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'mission_match';

-- CreateIndex
CREATE INDEX "MissionNotification_userId_createdAt_idx" ON "MissionNotification"("userId", "createdAt");
