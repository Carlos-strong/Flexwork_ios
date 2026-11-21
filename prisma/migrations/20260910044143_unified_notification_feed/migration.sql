-- Cloche unifiée (2026-09-09) : Notification.type passe de l'enum NotificationType (2 valeurs
-- KYC) à une chaîne applicative libre, même convention que MissionNotification.type et
-- Message.type — la cloche doit porter TOUS les événements (mission, KYC, messagerie).
--
-- SQL écrit à la main : la migration générée par Prisma faisait DROP COLUMN + ADD COLUMN,
-- ce qui aurait perdu le type des notifications déjà en base. Le cast en TEXT conserve les
-- valeurs existantes ("kyc_verifie" / "kyc_rejete") telles quelles.
ALTER TABLE "Notification" ALTER COLUMN "type" TYPE TEXT USING "type"::text;

-- Plus aucune colonne ne référence l'enum une fois le cast fait.
DROP TYPE "NotificationType";

-- Mission concernée par la notification (null pour les événements de compte, ex. KYC).
ALTER TABLE "Notification" ADD COLUMN "missionId" TEXT;

CREATE INDEX "Notification_userId_missionId_readAt_idx" ON "Notification"("userId", "missionId", "readAt");

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
