-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('client', 'expert_digital', 'expert_btp_autres', 'artisan', 'manoeuvre');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended', 'banned');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('kyc', 'moderation', 'mediation', 'superviseur');

-- CreateEnum
CREATE TYPE "KycStatus" AS ENUM ('en_attente', 'verifie', 'rejete');

-- CreateEnum
CREATE TYPE "OtpChannel" AS ENUM ('sms', 'whatsapp', 'email');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('signup', 'login', 'kyc');

-- CreateEnum
CREATE TYPE "KycDocType" AS ENUM ('piece_identite_recto', 'piece_identite_verso', 'selfie', 'selfie_avec_piece');

-- CreateEnum
CREATE TYPE "KycDocStatus" AS ENUM ('en_attente', 'verifie', 'rejete');

-- CreateEnum
CREATE TYPE "ProfessionalLevel" AS ENUM ('debutant', 'intermediaire', 'senior', 'expert');

-- CreateEnum
CREATE TYPE "DeclarationType" AS ENUM ('insurance', 'qualification');

-- CreateEnum
CREATE TYPE "ReferenceAppelStatus" AS ENUM ('a_appeler', 'confirme', 'injoignable');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('low', 'medium', 'high');

-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('brouillon', 'publiee', 'proposition_acceptee', 'contrat_genere', 'contrat_signe', 'fonds_sous_sequestre', 'en_cours', 'livrable_soumis', 'validee', 'cloturee', 'mediation_ouverte');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('envoyee', 'acceptee', 'refusee');

-- CreateEnum
CREATE TYPE "CheckInType" AS ENUM ('arrivee', 'depart');

-- CreateEnum
CREATE TYPE "EscrowInstructionType" AS ENUM ('hold', 'release', 'freeze', 'refund');

-- CreateEnum
CREATE TYPE "PspOperationStatus" AS ENUM ('pending', 'confirmed', 'failed');

-- CreateEnum
CREATE TYPE "MediationOutcome" AS ENUM ('en_cours', 'agreement', 'no_agreement', 'withdrawn');

-- CreateEnum
CREATE TYPE "ClientAcknowledgementType" AS ENUM ('no_insurance', 'unverified_qualification');

-- CreateEnum
CREATE TYPE "MissionInsuranceStatus" AS ENUM ('active', 'expired', 'cancelled');

-- CreateEnum
CREATE TYPE "VerificationSubjectType" AS ENUM ('kyc', 'declaration');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "tel" TEXT NOT NULL,
    "telVerified" BOOLEAN NOT NULL DEFAULT false,
    "passwordHash" TEXT,
    "role" "UserRole" NOT NULL DEFAULT 'client',
    "firstname" TEXT,
    "lastname" TEXT,
    "country" TEXT,
    "state" TEXT,
    "city" TEXT,
    "locality" TEXT,
    "address" TEXT,
    "status" "UserStatus" NOT NULL DEFAULT 'active',
    "isAdmin" BOOLEAN NOT NULL DEFAULT false,
    "adminRole" "AdminRole",
    "kycStatus" "KycStatus" NOT NULL DEFAULT 'en_attente',
    "deviceFingerprint" TEXT,
    "dateNaissance" TIMESTAMP(3),
    "dateNaissanceSetById" TEXT,
    "dateNaissanceSetAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "channel" "OtpChannel" NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KycDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "KycDocType" NOT NULL,
    "filePath" TEXT NOT NULL,
    "idNumberHash" TEXT,
    "status" "KycDocStatus" NOT NULL DEFAULT 'en_attente',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KycDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LivenessCheck" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'stub',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LivenessCheck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SelfieMatchLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "context" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SelfieMatchLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CountryAgeRequirement" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "profileType" "UserRole" NOT NULL,
    "domain" TEXT,
    "minimumAge" INTEGER NOT NULL,
    "legalReference" TEXT,
    "setByAdminId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CountryAgeRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mainDomain" TEXT NOT NULL,
    "subSpecialty" TEXT,
    "secondaryDomain" TEXT,
    "sector" TEXT,
    "indicativeRate" DOUBLE PRECISION,
    "declaredExperienceYears" INTEGER,
    "declaredLevel" "ProfessionalLevel",

    CONSTRAINT "Profile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfessionalDeclaration" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "declarationType" "DeclarationType" NOT NULL,
    "label" TEXT,
    "insurerName" TEXT,
    "policyNumber" TEXT,
    "coverageCeiling" DOUBLE PRECISION,
    "validUntil" TIMESTAMP(3),
    "declaredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "declarationTextSnapshot" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "previousHash" TEXT,
    "currentHash" TEXT NOT NULL,
    "removedAt" TIMESTAMP(3),
    "removedReason" TEXT,

    CONSTRAINT "ProfessionalDeclaration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeclarationDocument" (
    "id" TEXT NOT NULL,
    "declarationId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeclarationDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Garant" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "obligatoire" BOOLEAN NOT NULL DEFAULT false,
    "nom" TEXT NOT NULL,
    "tel" TEXT NOT NULL,
    "statutAppel" "ReferenceAppelStatus" NOT NULL DEFAULT 'a_appeler',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Garant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DomainRiskLevel" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL,
    "insuranceRequired" BOOLEAN NOT NULL,
    "amountThreshold" DOUBLE PRECISION,
    "justification" TEXT,

    CONSTRAINT "DomainRiskLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mission" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "titre" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "domaine" TEXT NOT NULL,
    "budget" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "delaiJours" INTEGER NOT NULL,
    "riskLevel" "RiskLevel" NOT NULL DEFAULT 'low',
    "insuranceRequired" BOOLEAN NOT NULL DEFAULT false,
    "status" "MissionStatus" NOT NULL DEFAULT 'brouillon',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Mission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionProposal" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "montant" DOUBLE PRECISION NOT NULL,
    "message" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'envoyee',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionNotification" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'stub',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionAttachment" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "uploaderId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MissionAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "flaggedLeakage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "note" INTEGER NOT NULL,
    "commentaire" TEXT,
    "suspendu" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrestationContract" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "contractDocumentUrl" TEXT,
    "termsSnapshot" JSONB NOT NULL,
    "acceptanceDeadlineDays" INTEGER NOT NULL DEFAULT 7,
    "clientSignedAt" TIMESTAMP(3),
    "providerSignedAt" TIMESTAMP(3),
    "previousHash" TEXT,
    "currentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clientOptedInCheckIn" BOOLEAN NOT NULL DEFAULT false,
    "providerOptedInCheckIn" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "PrestationContract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckInEvent" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "type" "CheckInType" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "gpsLat" DOUBLE PRECISION,
    "gpsLng" DOUBLE PRECISION,
    "retainUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckInEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PspEscrowOperation" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "pspName" TEXT NOT NULL,
    "pspReference" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'XOF',
    "instructionType" "EscrowInstructionType" NOT NULL,
    "instructionSentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pspConfirmedAt" TIMESTAMP(3),
    "webhookReference" TEXT,
    "status" "PspOperationStatus" NOT NULL DEFAULT 'pending',

    CONSTRAINT "PspEscrowOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Mediation" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "clientElements" JSONB,
    "providerElements" JSONB,
    "proposedResolution" TEXT,
    "clientAccepted" BOOLEAN,
    "providerAccepted" BOOLEAN,
    "outcome" "MediationOutcome" NOT NULL DEFAULT 'en_cours',
    "mediatorAdminId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "Mediation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientAcknowledgement" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "acknowledgementType" "ClientAcknowledgementType" NOT NULL,
    "textSnapshot" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,

    CONSTRAINT "ClientAcknowledgement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MissionInsurance" (
    "id" TEXT NOT NULL,
    "missionId" TEXT NOT NULL,
    "insurerName" TEXT NOT NULL,
    "policyReference" TEXT,
    "premiumAmount" DOUBLE PRECISION NOT NULL,
    "coverageCeiling" DOUBLE PRECISION NOT NULL,
    "coverageStart" TIMESTAMP(3) NOT NULL,
    "coverageEnd" TIMESTAMP(3) NOT NULL,
    "status" "MissionInsuranceStatus" NOT NULL DEFAULT 'active',

    CONSTRAINT "MissionInsurance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "justification" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationHistoryEntry" (
    "id" TEXT NOT NULL,
    "subjectType" "VerificationSubjectType" NOT NULL,
    "subjectId" TEXT NOT NULL,
    "event" TEXT NOT NULL,
    "previousHash" TEXT,
    "currentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationHistoryEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_tel_key" ON "User"("tel");

-- CreateIndex
CREATE INDEX "User_kycStatus_idx" ON "User"("kycStatus");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "OtpCode_userId_purpose_idx" ON "OtpCode"("userId", "purpose");

-- CreateIndex
CREATE INDEX "KycDocument_status_createdAt_idx" ON "KycDocument"("status", "createdAt");

-- CreateIndex
CREATE INDEX "KycDocument_idNumberHash_idx" ON "KycDocument"("idNumberHash");

-- CreateIndex
CREATE UNIQUE INDEX "CountryAgeRequirement_country_profileType_domain_key" ON "CountryAgeRequirement"("country", "profileType", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "Profile_userId_key" ON "Profile"("userId");

-- CreateIndex
CREATE INDEX "Profile_mainDomain_idx" ON "Profile"("mainDomain");

-- CreateIndex
CREATE UNIQUE INDEX "ProfessionalDeclaration_currentHash_key" ON "ProfessionalDeclaration"("currentHash");

-- CreateIndex
CREATE INDEX "ProfessionalDeclaration_profileId_declarationType_declaredA_idx" ON "ProfessionalDeclaration"("profileId", "declarationType", "declaredAt");

-- CreateIndex
CREATE INDEX "Garant_tel_idx" ON "Garant"("tel");

-- CreateIndex
CREATE UNIQUE INDEX "DomainRiskLevel_domain_country_key" ON "DomainRiskLevel"("domain", "country");

-- CreateIndex
CREATE INDEX "Mission_status_idx" ON "Mission"("status");

-- CreateIndex
CREATE INDEX "Mission_domaine_idx" ON "Mission"("domaine");

-- CreateIndex
CREATE INDEX "MissionProposal_missionId_status_idx" ON "MissionProposal"("missionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "MissionProposal_missionId_providerId_key" ON "MissionProposal"("missionId", "providerId");

-- CreateIndex
CREATE INDEX "MissionNotification_missionId_idx" ON "MissionNotification"("missionId");

-- CreateIndex
CREATE INDEX "MissionAttachment_missionId_idx" ON "MissionAttachment"("missionId");

-- CreateIndex
CREATE INDEX "Message_missionId_createdAt_idx" ON "Message"("missionId", "createdAt");

-- CreateIndex
CREATE INDEX "Review_targetId_idx" ON "Review"("targetId");

-- CreateIndex
CREATE UNIQUE INDEX "Review_missionId_authorId_key" ON "Review"("missionId", "authorId");

-- CreateIndex
CREATE UNIQUE INDEX "PrestationContract_missionId_key" ON "PrestationContract"("missionId");

-- CreateIndex
CREATE UNIQUE INDEX "PrestationContract_currentHash_key" ON "PrestationContract"("currentHash");

-- CreateIndex
CREATE INDEX "PrestationContract_missionId_idx" ON "PrestationContract"("missionId");

-- CreateIndex
CREATE INDEX "CheckInEvent_contractId_occurredAt_idx" ON "CheckInEvent"("contractId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "PspEscrowOperation_pspReference_key" ON "PspEscrowOperation"("pspReference");

-- CreateIndex
CREATE INDEX "PspEscrowOperation_contractId_status_idx" ON "PspEscrowOperation"("contractId", "status");

-- CreateIndex
CREATE INDEX "Mediation_contractId_outcome_idx" ON "Mediation"("contractId", "outcome");

-- CreateIndex
CREATE INDEX "ClientAcknowledgement_missionId_idx" ON "ClientAcknowledgement"("missionId");

-- CreateIndex
CREATE UNIQUE INDEX "MissionInsurance_missionId_key" ON "MissionInsurance"("missionId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_targetType_targetId_idx" ON "AdminAuditLog"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AdminAuditLog_adminId_createdAt_idx" ON "AdminAuditLog"("adminId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationHistoryEntry_currentHash_key" ON "VerificationHistoryEntry"("currentHash");

-- CreateIndex
CREATE INDEX "VerificationHistoryEntry_subjectType_subjectId_idx" ON "VerificationHistoryEntry"("subjectType", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_zone_key" ON "FeatureFlag"("key", "zone");

-- AddForeignKey
ALTER TABLE "OtpCode" ADD CONSTRAINT "OtpCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KycDocument" ADD CONSTRAINT "KycDocument_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LivenessCheck" ADD CONSTRAINT "LivenessCheck_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SelfieMatchLog" ADD CONSTRAINT "SelfieMatchLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Profile" ADD CONSTRAINT "Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionalDeclaration" ADD CONSTRAINT "ProfessionalDeclaration_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeclarationDocument" ADD CONSTRAINT "DeclarationDocument_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "ProfessionalDeclaration"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Garant" ADD CONSTRAINT "Garant_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "Profile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mission" ADD CONSTRAINT "Mission_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionProposal" ADD CONSTRAINT "MissionProposal_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionProposal" ADD CONSTRAINT "MissionProposal_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionNotification" ADD CONSTRAINT "MissionNotification_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionNotification" ADD CONSTRAINT "MissionNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionAttachment" ADD CONSTRAINT "MissionAttachment_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrestationContract" ADD CONSTRAINT "PrestationContract_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrestationContract" ADD CONSTRAINT "PrestationContract_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrestationContract" ADD CONSTRAINT "PrestationContract_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckInEvent" ADD CONSTRAINT "CheckInEvent_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "PrestationContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PspEscrowOperation" ADD CONSTRAINT "PspEscrowOperation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "PrestationContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mediation" ADD CONSTRAINT "Mediation_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "PrestationContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mediation" ADD CONSTRAINT "Mediation_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Mediation" ADD CONSTRAINT "Mediation_mediatorAdminId_fkey" FOREIGN KEY ("mediatorAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAcknowledgement" ADD CONSTRAINT "ClientAcknowledgement_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientAcknowledgement" ADD CONSTRAINT "ClientAcknowledgement_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MissionInsurance" ADD CONSTRAINT "MissionInsurance_missionId_fkey" FOREIGN KEY ("missionId") REFERENCES "Mission"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminAuditLog" ADD CONSTRAINT "AdminAuditLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
