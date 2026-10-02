-- Lien du profil prestataire vers la taxonomie (2026-09-23).
-- `mainDomain` conserve le libellé (c'est lui qui sert au rapprochement) ; la FK, elle, dit
-- de quelle CATÉGORIE il vient — ce qu'un libellé seul ne permet pas de retrouver.
-- Nullable : les profils antérieurs n'ont que le texte, et rien ne peut deviner son métier.
ALTER TABLE "Profile" ADD COLUMN "metierId" TEXT;
CREATE INDEX "Profile_metierId_idx" ON "Profile"("metierId");
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_metierId_fkey" FOREIGN KEY ("metierId") REFERENCES "metiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
