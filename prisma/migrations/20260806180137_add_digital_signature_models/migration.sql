-- CreateEnum
CREATE TYPE "CertificateStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

-- CreateTable
CREATE TABLE "DigitalCertificate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "commonName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "organization" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "status" "CertificateStatus" NOT NULL DEFAULT 'ACTIVE',
    "publicKey" TEXT NOT NULL,
    "encryptedPrivateKey" TEXT NOT NULL,
    "keyFingerprint" TEXT NOT NULL,
    "keySalt" TEXT NOT NULL,
    "keyIv" TEXT NOT NULL,
    "keyAuthTag" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigitalCertificate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractSignature" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "certificateId" TEXT NOT NULL,
    "signedDataHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "signingMethod" TEXT NOT NULL DEFAULT 'RSA-SHA256',
    "signedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "signerIp" TEXT,
    "signerUserAgent" TEXT,

    CONSTRAINT "ContractSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractAuditEntry" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "previousHash" TEXT,
    "currentHash" TEXT NOT NULL,
    "systemSignature" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractAuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DigitalCertificate_keyFingerprint_key" ON "DigitalCertificate"("keyFingerprint");

-- CreateIndex
CREATE INDEX "DigitalCertificate_userId_status_idx" ON "DigitalCertificate"("userId", "status");

-- CreateIndex
CREATE INDEX "ContractSignature_contractId_idx" ON "ContractSignature"("contractId");

-- CreateIndex
CREATE INDEX "ContractSignature_certificateId_idx" ON "ContractSignature"("certificateId");

-- CreateIndex
CREATE UNIQUE INDEX "ContractAuditEntry_currentHash_key" ON "ContractAuditEntry"("currentHash");

-- CreateIndex
CREATE INDEX "ContractAuditEntry_contractId_createdAt_idx" ON "ContractAuditEntry"("contractId", "createdAt");

-- AddForeignKey
ALTER TABLE "DigitalCertificate" ADD CONSTRAINT "DigitalCertificate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractSignature" ADD CONSTRAINT "ContractSignature_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "PrestationContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractSignature" ADD CONSTRAINT "ContractSignature_certificateId_fkey" FOREIGN KEY ("certificateId") REFERENCES "DigitalCertificate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractAuditEntry" ADD CONSTRAINT "ContractAuditEntry_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "PrestationContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
