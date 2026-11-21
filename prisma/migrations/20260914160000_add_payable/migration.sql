-- CreateEnum
CREATE TYPE "PayableSourceType" AS ENUM ('jalon', 'mission', 'retention', 'mediation', 'gig_order');

-- CreateEnum
CREATE TYPE "PayableStatus" AS ENUM ('validated', 'instructed', 'paid', 'failed');

-- CreateTable
CREATE TABLE "Payable" (
    "id" TEXT NOT NULL,
    "contractId" TEXT,
    "missionId" TEXT,
    "sourceType" "PayableSourceType" NOT NULL,
    "sourceId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "status" "PayableStatus" NOT NULL DEFAULT 'validated',
    "escrowOperationId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "Payable_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Payable_escrowOperationId_key" ON "Payable"("escrowOperationId");

-- CreateIndex
CREATE UNIQUE INDEX "Payable_idempotencyKey_key" ON "Payable"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payable_contractId_status_idx" ON "Payable"("contractId", "status");

-- CreateIndex
CREATE INDEX "Payable_sourceType_sourceId_idx" ON "Payable"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "PrestationContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payable" ADD CONSTRAINT "Payable_escrowOperationId_fkey" FOREIGN KEY ("escrowOperationId") REFERENCES "PspEscrowOperation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
