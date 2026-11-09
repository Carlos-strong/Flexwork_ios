-- Journal append-only des messages reçus du PSP (webhooks, console virtuelle, autoconfirmation).
-- Additif ; sans clé étrangère, pour survivre à la suppression des contrats et consigner les
-- références inconnues.
CREATE TYPE "PspEventChannel" AS ENUM ('webhook', 'virtual_console', 'autoconfirm');
CREATE TYPE "PspEventOutcome" AS ENUM ('applied', 'replayed', 'rejected');

CREATE TABLE "PspEventLog" (
    "id" TEXT NOT NULL,
    "channel" "PspEventChannel" NOT NULL,
    "event" TEXT NOT NULL,
    "pspReference" TEXT,
    "operationId" TEXT,
    "contractId" TEXT,
    "orderId" TEXT,
    "instructionType" "EscrowInstructionType",
    "amount" DOUBLE PRECISION,
    "outcome" "PspEventOutcome" NOT NULL,
    "error" TEXT,
    "signatureValid" BOOLEAN NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PspEventLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PspEventLog_receivedAt_idx" ON "PspEventLog"("receivedAt");
CREATE INDEX "PspEventLog_pspReference_idx" ON "PspEventLog"("pspReference");
CREATE INDEX "PspEventLog_operationId_idx" ON "PspEventLog"("operationId");
CREATE INDEX "PspEventLog_outcome_receivedAt_idx" ON "PspEventLog"("outcome", "receivedAt");
