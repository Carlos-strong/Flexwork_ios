-- CreateEnum
CREATE TYPE "ReportTargetType" AS ENUM ('declaration', 'profile', 'mission', 'review');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('ouvert', 'retenu', 'classe');

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "targetType" "ReportTargetType" NOT NULL,
    "targetId" TEXT,
    "reason" TEXT NOT NULL,
    "reporterId" TEXT,
    "sourceHash" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'ouvert',
    "handledById" TEXT,
    "handledAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_status_createdAt_idx" ON "Report"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Report_sourceHash_createdAt_idx" ON "Report"("sourceHash", "createdAt");

-- CreateIndex
CREATE INDEX "Report_reporterId_createdAt_idx" ON "Report"("reporterId", "createdAt");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_handledById_fkey" FOREIGN KEY ("handledById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
