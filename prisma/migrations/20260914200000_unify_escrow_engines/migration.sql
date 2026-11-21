-- Unification des deux moteurs de séquestre (2026-09-14).
-- Les opérations des commandes Gig rejoignent le registre unique PspEscrowOperation.
-- Migration de DONNÉES : les lignes existantes sont transférées, pas recréées.

-- CreateEnum
CREATE TYPE "EscrowSourceType" AS ENUM ('mission_contract', 'gig_order');

-- AlterTable : portée générique
ALTER TABLE "PspEscrowOperation" ADD COLUMN "sourceType" "EscrowSourceType" NOT NULL DEFAULT 'mission_contract';
ALTER TABLE "PspEscrowOperation" ADD COLUMN "orderId" TEXT;

-- Les lignes existantes sont toutes des opérations de contrat : le défaut ci-dessus les couvre.
-- `contractId` ne devient nullable qu'APRÈS, pour qu'aucune ligne existante ne puisse perdre
-- son rattachement pendant l'opération.
ALTER TABLE "PspEscrowOperation" DROP CONSTRAINT "PspEscrowOperation_contractId_fkey";
ALTER TABLE "PspEscrowOperation" ALTER COLUMN "contractId" DROP NOT NULL;
ALTER TABLE "PspEscrowOperation" ADD CONSTRAINT "PspEscrowOperation_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "PrestationContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PspEscrowOperation" ADD CONSTRAINT "PspEscrowOperation_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "GigOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Transfert des opérations Gig. `pspReference` est NULL sur toutes ces lignes (le domaine Gig
-- n'a jamais eu de webhook : ses instructions sont créées confirmées), donc aucun risque de
-- collision avec l'index unique.
INSERT INTO "PspEscrowOperation" (
  "id", "sourceType", "contractId", "orderId", "jalonId", "pspName", "pspReference",
  "amount", "currency", "instructionType", "instructionSentAt", "pspConfirmedAt",
  "webhookReference", "status"
)
SELECT
  "id", 'gig_order'::"EscrowSourceType", NULL, "orderId", NULL, "pspName", "pspReference",
  "amount", "currency", "instructionType", "instructionSentAt", "pspConfirmedAt",
  NULL, "status"
FROM "GigOrderEscrowOperation";

-- CreateIndex
CREATE INDEX "PspEscrowOperation_orderId_status_idx" ON "PspEscrowOperation"("orderId", "status");

-- DropTable : les données sont transférées ci-dessus.
DROP TABLE "GigOrderEscrowOperation";

-- Garde-fou d'intégrité : exactement UNE portée renseignée, cohérente avec le discriminant.
-- La base refuse désormais une opération orpheline ou rattachée aux deux domaines à la fois —
-- ce qu'aucune contrainte ne pouvait exprimer tant que chaque domaine avait sa table.
ALTER TABLE "PspEscrowOperation" ADD CONSTRAINT "PspEscrowOperation_scope_exclusive" CHECK (
  ("sourceType" = 'mission_contract' AND "contractId" IS NOT NULL AND "orderId" IS NULL)
  OR
  ("sourceType" = 'gig_order' AND "orderId" IS NOT NULL AND "contractId" IS NULL)
);
