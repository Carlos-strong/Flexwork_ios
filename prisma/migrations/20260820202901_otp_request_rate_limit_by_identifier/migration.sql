-- CreateTable
CREATE TABLE "OtpRequestAttempt" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpRequestAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpRequestAttempt_identifier_createdAt_idx" ON "OtpRequestAttempt"("identifier", "createdAt");
