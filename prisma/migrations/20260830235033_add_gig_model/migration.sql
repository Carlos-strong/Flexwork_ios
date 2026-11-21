-- CreateEnum
CREATE TYPE "GigStatus" AS ENUM ('brouillon', 'publie', 'cloture');

-- CreateEnum
CREATE TYPE "GigOrderStatus" AS ENUM ('created', 'client_signed', 'active', 'completed', 'cancelled', 'refunded');

-- CreateTable
CREATE TABLE "Gig" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "domaine" TEXT NOT NULL,
    "prix" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "delaiJours" INTEGER NOT NULL,
    "tags" TEXT[],
    "status" "GigStatus" NOT NULL DEFAULT 'brouillon',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Gig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GigOrder" (
    "id" TEXT NOT NULL,
    "gigId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "montant" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "termsSnapshot" JSONB NOT NULL,
    "status" "GigOrderStatus" NOT NULL DEFAULT 'created',
    "clientSignedAt" TIMESTAMP(3),
    "providerSignedAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GigOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GigOrderSignature" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "signedDataHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "signingMethod" TEXT NOT NULL DEFAULT 'RSA-SHA256',
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "signerIp" TEXT,
    "signerUserAgent" TEXT,

    CONSTRAINT "GigOrderSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GigOrderAuditEntry" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "previousHash" TEXT,
    "currentHash" TEXT NOT NULL,
    "systemSignature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GigOrderAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GigOrderEscrowOperation" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "pspName" TEXT NOT NULL,
    "pspReference" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "instructionType" "EscrowInstructionType" NOT NULL,
    "instructionSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pspConfirmedAt" TIMESTAMP(3),
    "status" "PspOperationStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "GigOrderEscrowOperation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Gig_status_createdAt_idx" ON "Gig"("status", "createdAt");

-- CreateIndex
CREATE INDEX "Gig_providerId_idx" ON "Gig"("providerId");

-- CreateIndex
CREATE INDEX "GigOrder_gigId_idx" ON "GigOrder"("gigId");

-- CreateIndex
CREATE INDEX "GigOrder_clientId_status_idx" ON "GigOrder"("clientId", "status");

-- CreateIndex
CREATE INDEX "GigOrder_providerId_status_idx" ON "GigOrder"("providerId", "status");

-- CreateIndex
CREATE INDEX "GigOrderSignature_orderId_idx" ON "GigOrderSignature"("orderId");

-- CreateIndex
CREATE INDEX "GigOrderSignature_certificateId_idx" ON "GigOrderSignature"("certificateId");

-- CreateIndex
CREATE UNIQUE INDEX "GigOrderAuditEntry_currentHash_key" ON "GigOrderAuditEntry"("currentHash");

-- CreateIndex
CREATE INDEX "GigOrderAuditEntry_orderId_createdAt_idx" ON "GigOrderAuditEntry"("orderId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GigOrderEscrowOperation_pspReference_key" ON "GigOrderEscrowOperation"("pspReference");

-- CreateIndex
CREATE INDEX "GigOrderEscrowOperation_orderId_status_idx" ON "GigOrderEscrowOperation"("orderId", "status");

-- AddForeignKey
ALTER TABLE "Gig" ADD CONSTRAINT "Gig_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GigOrder" ADD CONSTRAINT "GigOrder_gigId_fkey" FOREIGN KEY ("gigId") REFERENCES "Gig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GigOrder" ADD CONSTRAINT "GigOrder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GigOrder" ADD CONSTRAINT "GigOrder_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GigOrderSignature" ADD CONSTRAINT "GigOrderSignature_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "GigOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GigOrderSignature" ADD CONSTRAINT "GigOrderSignature_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "DigitalCertificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GigOrderAuditEntry" ADD CONSTRAINT "GigOrderAuditEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "GigOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GigOrderEscrowOperation" ADD CONSTRAINT "GigOrderEscrowOperation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "GigOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
