-- AlterTable
ALTER TABLE "OtpRequestAttempt" ADD COLUMN     "ip" TEXT;

-- CreateIndex
CREATE INDEX "OtpRequestAttempt_createdAt_idx" ON "OtpRequestAttempt"("createdAt");
