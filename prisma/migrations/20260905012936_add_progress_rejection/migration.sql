-- CreateTable
CREATE TABLE "ProgressRejection" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "jalonId" TEXT,
    "reason" TEXT NOT NULL,
    "rejectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressRejection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgressRejection_missionId_createdAt_idx" ON "ProgressRejection"("missionId", "createdAt");

-- CreateIndex
CREATE INDEX "ProgressRejection_jalonId_idx" ON "ProgressRejection"("jalonId");

-- AddForeignKey
ALTER TABLE "ProgressRejection" ADD CONSTRAINT "ProgressRejection_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressRejection" ADD CONSTRAINT "ProgressRejection_jalonId_fkey" FOREIGN KEY ("jalonId") REFERENCES "Jalon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressRejection" ADD CONSTRAINT "ProgressRejection_rejectedById_fkey" FOREIGN KEY ("rejectedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
