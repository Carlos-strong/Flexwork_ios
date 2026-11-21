-- Contrat au TEMPS (S2) et module de pointage — §9 à §13 du cahier des charges.
-- Migration strictement ADDITIVE : aucune table ni colonne existante n'est modifiée.

-- CreateEnum
CREATE TYPE "RateUnit" AS ENUM ('hour', 'day', 'month');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('open', 'submitted', 'approved', 'rejected', 'disputed', 'cancelled');

-- AlterEnum
ALTER TYPE "PayableSourceType" ADD VALUE 'attendance';

-- CreateTable
CREATE TABLE "SpotTimeTerms" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "rateUnit" "RateUnit" NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "maxQuantity" DOUBLE PRECISION NOT NULL,
    "maxAmount" DOUBLE PRECISION NOT NULL,
    "overtimeAllowed" BOOLEAN NOT NULL DEFAULT false,
    "overtimeRate" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SpotTimeTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "declaredQuantity" DOUBLE PRECISION NOT NULL,
    "approvedQuantity" DOUBLE PRECISION,
    "overtimeQuantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" "AttendanceStatus" NOT NULL DEFAULT 'open',
    "rejectionReason" TEXT,
    "validatedById" TEXT,
    "validatedAt" TIMESTAMP(3),
    "payableId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SpotTimeTerms_contractId_key" ON "SpotTimeTerms"("contractId");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_payableId_key" ON "Attendance"("payableId");

-- CreateIndex
CREATE INDEX "Attendance_contractId_status_idx" ON "Attendance"("contractId", "status");

-- CreateIndex
CREATE INDEX "Attendance_workerId_idx" ON "Attendance"("workerId");

-- Interdit le double pointage d'une même période — contrainte en BASE, seule façon qu'elle
-- tienne sous concurrence.
CREATE UNIQUE INDEX "Attendance_contractId_periodStart_periodEnd_key" ON "Attendance"("contractId", "periodStart", "periodEnd");

-- AddForeignKey
ALTER TABLE "SpotTimeTerms" ADD CONSTRAINT "SpotTimeTerms_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "PrestationContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "PrestationContract"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_payableId_fkey" FOREIGN KEY ("payableId") REFERENCES "Payable"("id") ON DELETE SET NULL ON UPDATE CASCADE;
