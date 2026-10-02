-- Acceptation versionnée et chaînée des CGU (2026-09-23).
-- Le pourquoi (versionnement + chaînage) est documenté sur le modèle TermsAcceptance.
CREATE TABLE "TermsAcceptance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "termsVersion" TEXT NOT NULL,
    "effectiveAt" TIMESTAMP(3) NOT NULL,
    "digest" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "previousHash" TEXT,
    "chainedHash" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TermsAcceptance_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TermsAcceptance_userId_acceptedAt_idx" ON "TermsAcceptance"("userId", "acceptedAt");
CREATE INDEX "TermsAcceptance_termsVersion_idx" ON "TermsAcceptance"("termsVersion");
ALTER TABLE "TermsAcceptance" ADD CONSTRAINT "TermsAcceptance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
