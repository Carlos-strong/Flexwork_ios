-- Double pointage d'une même période : l'invariant est « pas deux relevés ACTIFS », et non
-- « pas deux lignes ». Un index unique TOTAL condamnait la journée dès le premier refus — le
-- prestataire ne pouvait plus corriger et redéclarer, alors que c'est ce qu'un refus lui demande.
DROP INDEX IF EXISTS "Attendance_contractId_periodStart_periodEnd_key";

CREATE UNIQUE INDEX "Attendance_active_period_key"
  ON "Attendance" ("contractId", "periodStart", "periodEnd")
  WHERE "status" NOT IN ('rejected', 'cancelled');
