-- Candidatures retenues faute de KYC vérifié (2026-11-09) : voir le modèle ProposalDraft.
CREATE TABLE "ProposalDraft" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProposalDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProposalDraft_missionId_providerId_key" ON "ProposalDraft"("missionId", "providerId");
CREATE INDEX "ProposalDraft_providerId_idx" ON "ProposalDraft"("providerId");

ALTER TABLE "ProposalDraft" ADD CONSTRAINT "ProposalDraft_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProposalDraft" ADD CONSTRAINT "ProposalDraft_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
