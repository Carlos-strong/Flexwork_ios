-- Boîte d'envoi des instructions PSP, boîte de réception des webhooks, reprise des créances.

CREATE TYPE "PspDispatchStatus" AS ENUM ('a_envoyer', 'en_cours', 'envoyee', 'echec_envoi');
CREATE TYPE "PspInboundStatus" AS ENUM ('recu', 'en_cours', 'traite', 'rejete', 'echec');
ALTER TYPE "PspEventChannel" ADD VALUE 'reconciliation';

ALTER TABLE "PspEscrowOperation"
  ADD COLUMN "dispatchStatus" "PspDispatchStatus" NOT NULL DEFAULT 'a_envoyer',
  ADD COLUMN "dispatchAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextDispatchAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "dispatchLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "dispatchedAt" TIMESTAMP(3),
  ADD COLUMN "lastDispatchError" TEXT;

-- Tout ce qui existe déjà a été traité par l'ancien chemin (transmission implicite) : rien à
-- renvoyer.
UPDATE "PspEscrowOperation" SET "dispatchStatus" = 'envoyee', "dispatchedAt" = "instructionSentAt";

CREATE INDEX "PspEscrowOperation_dispatchStatus_nextDispatchAt_idx" ON "PspEscrowOperation"("dispatchStatus", "nextDispatchAt");
CREATE INDEX "PspEscrowOperation_status_dispatchedAt_idx" ON "PspEscrowOperation"("status", "dispatchedAt");

CREATE TABLE "PspInboundEvent" (
    "id" TEXT NOT NULL,
    "pspReference" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "rawBody" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "status" "PspInboundStatus" NOT NULL DEFAULT 'recu',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "lastError" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "PspInboundEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PspInboundEvent_pspReference_event_key" ON "PspInboundEvent"("pspReference", "event");
CREATE INDEX "PspInboundEvent_status_nextAttemptAt_idx" ON "PspInboundEvent"("status", "nextAttemptAt");

ALTER TABLE "Payable"
  ADD COLUMN "retryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextRetryAt" TIMESTAMP(3);
CREATE INDEX "Payable_status_nextRetryAt_idx" ON "Payable"("status", "nextRetryAt");
