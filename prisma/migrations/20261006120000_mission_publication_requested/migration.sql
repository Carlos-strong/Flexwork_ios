-- Publication demandée avant vérification d'identité (2026-10-06) : voir Mission.publicationRequestedAt.
ALTER TABLE "Mission" ADD COLUMN "publicationRequestedAt" TIMESTAMP(3);
