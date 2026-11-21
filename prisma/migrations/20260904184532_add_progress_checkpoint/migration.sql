-- CreateTable
CREATE TABLE "ProgressCheckpoint" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "jalonId" TEXT,
    "progress" INTEGER NOT NULL,
    "validatedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgressCheckpoint_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgressCheckpoint_missionId_createdAt_idx" ON "ProgressCheckpoint"("missionId", "createdAt");

-- CreateIndex
CREATE INDEX "ProgressCheckpoint_jalonId_idx" ON "ProgressCheckpoint"("jalonId");

-- AddForeignKey
ALTER TABLE "ProgressCheckpoint" ADD CONSTRAINT "ProgressCheckpoint_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressCheckpoint" ADD CONSTRAINT "ProgressCheckpoint_jalonId_fkey" FOREIGN KEY ("jalonId") REFERENCES "Jalon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgressCheckpoint" ADD CONSTRAINT "ProgressCheckpoint_validatedById_fkey" FOREIGN KEY ("validatedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
