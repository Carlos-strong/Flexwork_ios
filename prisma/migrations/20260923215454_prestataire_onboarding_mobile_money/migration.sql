-- CreateEnum
CREATE TYPE "MobileMoneyOperator" AS ENUM ('mtn', 'moov', 'celtiis');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('non_renseigne', 'en_attente', 'verifie', 'rejete');

-- CreateEnum
CREATE TYPE "ProviderKind" AS ENUM ('independant', 'entreprise', 'artisan', 'manoeuvre');

-- CreateEnum
CREATE TYPE "WorkMode" AS ENUM ('presentiel', 'distance', 'hybride');

-- CreateEnum
CREATE TYPE "Availability" AS ENUM ('temps_plein', 'temps_partiel', 'ponctuel', 'indisponible');

-- AlterEnum
ALTER TYPE "KycDocType" ADD VALUE 'justificatif_domicile';

-- AlterTable
ALTER TABLE "Profile" ADD COLUMN     "availability" "Availability",
ADD COLUMN     "coverageZones" TEXT[],
ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'XOF',
ADD COLUMN     "offeredServices" TEXT[],
ADD COLUMN     "providerKind" "ProviderKind",
ADD COLUMN     "title" VARCHAR(120),
ADD COLUMN     "workModes" "WorkMode"[];

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isProvider" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "providerActivatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PayoutAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operator" "MobileMoneyOperator" NOT NULL,
    "number" TEXT NOT NULL,
    "holder" TEXT NOT NULL,
    "addressProofDocId" TEXT,
    "status" "PayoutStatus" NOT NULL DEFAULT 'en_attente',
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "refusalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayoutAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayoutAccount_userId_key" ON "PayoutAccount"("userId");

-- CreateIndex
CREATE INDEX "PayoutAccount_status_submittedAt_idx" ON "PayoutAccount"("status", "submittedAt");

-- AddForeignKey
ALTER TABLE "PayoutAccount" ADD CONSTRAINT "PayoutAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutAccount" ADD CONSTRAINT "PayoutAccount_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill (2026-09-23) : `isProvider` est un drapeau NOUVEAU, donc faux par défaut pour tout
-- le monde — y compris les comptes qui exercent déjà une filière prestataire. Sans cette
-- reprise, chaque prestataire existant deviendrait rétroactivement « un client qui n'a pas
-- encore activé son espace » : il perdrait l'accès à son tableau de bord et devrait
-- re-demander une activation qu'il n'a jamais eue à demander.
--
-- La date d'activation est celle de la CRÉATION du compte : c'est le moment où la filière a
-- été choisie, et inventer une date plus récente fausserait l'historique d'un recours.
UPDATE "User"
SET "isProvider" = true,
    "providerActivatedAt" = COALESCE("providerActivatedAt", "createdAt")
WHERE "role" IN ('expert_digital', 'expert_btp_autres', 'artisan', 'manoeuvre');

-- Reprise de cohérence : une devise vide sur un profil existant prendrait la valeur par
-- défaut de la colonne, mais les profils créés avant cette migration n'ont pas eu de DEFAULT
-- appliqué sur une valeur déjà présente — on s'assure qu'aucune ligne ne reste sans devise.
UPDATE "Profile" SET "currency" = 'XOF' WHERE "currency" IS NULL OR "currency" = '';

-- Les tableaux vides remplacent NULL sur les colonnes ajoutées : le code lit `tags`/`workModes`
-- comme des listes, et `null` y produirait des écrans à « undefined ».
UPDATE "Profile" SET "offeredServices" = '{}' WHERE "offeredServices" IS NULL;
UPDATE "Profile" SET "workModes" = '{}' WHERE "workModes" IS NULL;
UPDATE "Profile" SET "coverageZones" = '{}' WHERE "coverageZones" IS NULL;
