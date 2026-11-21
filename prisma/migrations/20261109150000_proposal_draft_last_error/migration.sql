-- Raison du dernier échec de l'envoi automatique d'une candidature en attente (2026-11-09).
ALTER TABLE "ProposalDraft" ADD COLUMN "lastError" TEXT;
