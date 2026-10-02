/**
 * Côté CLIENT — relevés de présence, clôture et recharge d'un contrat au temps.
 *
 * Plan de tests (PLAN_TESTS_MODELE_PAIEMENT.md) : T-V04, T-V10, T-V14, T-V29, T-F03, V-R10,
 * V-P13. Chaque cas a son propre contrat financé : les plafonds et les cumuls d'un cas ne
 * doivent pas déteindre sur le suivant.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import type { AttendanceValidation, RateUnit, ValidationMode } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requestContractHold } from "@/lib/escrow";
import { requestRecharge } from "@/lib/escrow-recharge";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import {
  approveAttendance,
  closeTimeContract,
  rejectAttendance,
  submitAttendance,
  verifyAttendance,
} from "@/lib/spot-time-actions";
import { dayPeriod } from "@/lib/spot-time";

const RUN = Date.now();
let clientId = "";
let providerId = "";
let managerId = "";
const missionIds: string[] = [];
let seq = 0;

const jour = (n: number) => dayPeriod(new Date(Date.UTC(2026, 10, n)));

/** Contrat au temps signé et financé, prêt à recevoir des relevés. */
async function contrat(opts: {
  rateUnit?: RateUnit;
  rate: number;
  maxQuantity: number;
  maxAmount: number;
  overtimeAllowed?: boolean;
  overtimeRate?: number | null;
  attendanceValidation?: AttendanceValidation;
  validationMode?: ValidationMode;
  siteManagerId?: string | null;
}) {
  seq++;
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Relevés client ${RUN}-${seq}`,
      description: "Contrat au temps — tests côté client.",
      domaine: "batiment",
      budget: opts.maxAmount,
      currency: "XOF",
      delaiJours: 30,
      riskLevel: "low",
      status: "contrat_signe",
      financingModeKey: opts.rateUnit === "hour" ? "S2H" : "S2J",
      validationMode: opts.validationMode ?? "client",
    },
  });
  missionIds.push(mission.id);
  const contract = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId,
      providerId,
      termsSnapshot: { prix: opts.maxAmount, devise: "XOF" },
      currentHash: `hash-releves-${RUN}-${seq}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      validationMode: opts.validationMode ?? "client",
      siteManagerId: opts.siteManagerId ?? null,
      spotTimeTerms: {
        create: {
          rateUnit: opts.rateUnit ?? "day",
          rate: opts.rate,
          maxQuantity: opts.maxQuantity,
          maxAmount: opts.maxAmount,
          overtimeAllowed: opts.overtimeAllowed ?? false,
          overtimeRate: opts.overtimeRate ?? null,
          attendanceValidation: opts.attendanceValidation ?? "partielle",
        },
      },
    },
  });
  const hold = await requestContractHold(contract.id);
  if (!hold.ok) throw new Error(`financement attendu : ${hold.error}`);
  await operateVirtualPsp("authorize", hold.operation.pspReference!);
  return { contractId: contract.id, missionId: mission.id };
}

async function declarer(contractId: string, n: number, declaredQuantity: number) {
  const res = await submitAttendance({ contractId, workerId: providerId, ...jour(n), declaredQuantity });
  if (!res.ok) throw new Error(`déclaration refusée : ${res.error}`);
  return res.attendanceId;
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;
  const mk = (key: string, role: string, n: number) =>
    prisma.user.create({
      data: { email: `cr-${key}-${RUN}@flexwork.test`, tel: `+229${RUN}6${n}`, role: role as "client", status: "active", country: "BJ" },
    });
  clientId = (await mk("client", "client", 0)).id;
  providerId = (await mk("presta", "manoeuvre", 1)).id;
  managerId = (await mk("rc", "responsable_chantier", 2)).id;
  await prisma.featureFlag.upsert({
    where: { key_zone: { key: "psp_montage_valide", zone: "BJ" } },
    update: { enabled: true },
    create: { key: "psp_montage_valide", zone: "BJ", enabled: true },
  });
});

afterAll(async () => {
  const contrats = await prisma.prestationContract.findMany({ where: { missionId: { in: missionIds } }, select: { id: true } });
  const contractIds = contrats.map((c) => c.id);
  await prisma.missionNotification.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.attendance.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.payable.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.pspEventLog.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId, managerId] } } });
});

describe("décisions du client sur les relevés", () => {
  it("T-V04 — refuser un relevé sans motif est refusé", async () => {
    const { contractId } = await contrat({ rate: 7_500, maxQuantity: 20, maxAmount: 150_000 });
    const releve = await declarer(contractId, 1, 1);
    expect(await rejectAttendance({ attendanceId: releve, validatorId: clientId, reason: "   " })).toEqual({
      ok: false,
      error: "rejection_reason_required",
    });
    expect((await prisma.attendance.findUniqueOrThrow({ where: { id: releve } })).status).toBe("submitted");
  });

  it("T-V10 — tarif issu d'un plafond négocié : le dernier relevé solde exactement le plafond", async () => {
    // 150 001 sur 20 jours : tarif 7 500,05, arrondi relevé par relevé.
    const { contractId } = await contrat({ rate: 150_001 / 20, maxQuantity: 20, maxAmount: 150_001 });
    const r1 = await declarer(contractId, 2, 19);
    const v1 = await approveAttendance({ attendanceId: r1, validatorId: clientId, approvedQuantity: 19 });
    const r2 = await declarer(contractId, 3, 1);
    const v2 = await approveAttendance({ attendanceId: r2, validatorId: clientId, approvedQuantity: 1 });
    if (!v1.ok || !v2.ok) throw new Error("validations attendues");
    // Sans reliquat d'arrondi : la somme des créances vaut le plafond au franc près.
    expect(v1.amount + v2.amount).toBe(150_001);
  });

  it("T-V14 — heures supplémentaires : majorées si le contrat les autorise, au tarif normal sinon", async () => {
    const { contractId } = await contrat({
      rateUnit: "hour",
      rate: 1_000,
      maxQuantity: 100,
      maxAmount: 100_000,
      overtimeAllowed: true,
      overtimeRate: 1_500,
    });
    const r1 = await declarer(contractId, 4, 9);
    expect(await approveAttendance({ attendanceId: r1, validatorId: clientId, approvedQuantity: 9, overtimeQuantity: 1 })).toMatchObject({
      ok: true,
      amount: 8 * 1_000 + 1 * 1_500,
    });

    // Non autorisées : jamais refusées — payées au tarif normal.
    await prisma.spotTimeTerms.update({ where: { contractId }, data: { overtimeAllowed: false } });
    const r2 = await declarer(contractId, 5, 9);
    expect(await approveAttendance({ attendanceId: r2, validatorId: clientId, approvedQuantity: 9, overtimeQuantity: 1 })).toMatchObject({
      ok: true,
      amount: 9 * 1_000,
    });
  });

  it("T-V29 — validation totale + heures sup. : la quantité reste celle déclarée, seule la part majorée se saisit", async () => {
    const { contractId } = await contrat({
      rateUnit: "hour",
      rate: 1_000,
      maxQuantity: 100,
      maxAmount: 100_000,
      overtimeAllowed: true,
      overtimeRate: 1_500,
      attendanceValidation: "totale",
    });
    const releve = await declarer(contractId, 6, 9);
    expect(await approveAttendance({ attendanceId: releve, validatorId: clientId, approvedQuantity: 8, overtimeQuantity: 2 })).toEqual({
      ok: false,
      error: "partial_validation_not_allowed",
    });
    expect(await approveAttendance({ attendanceId: releve, validatorId: clientId, approvedQuantity: 9, overtimeQuantity: 2 })).toMatchObject({
      ok: true,
      amount: 7 * 1_000 + 2 * 1_500,
    });
  });
});

describe("clôture et recharge", () => {
  it("T-F03 — clôturer pendant une médiation est refusé", async () => {
    const { missionId } = await contrat({ rate: 7_500, maxQuantity: 20, maxAmount: 150_000 });
    await prisma.mission.update({ where: { id: missionId }, data: { status: "mediation_ouverte" } });
    expect(await closeTimeContract({ missionId, clientId })).toMatchObject({ ok: false, error: "mediation_open" });
  });

  it("V-R10 — OPR : un relevé vérifié mais pas encore validé bloque la clôture", async () => {
    const { contractId, missionId } = await contrat({
      rate: 7_500,
      maxQuantity: 20,
      maxAmount: 150_000,
      validationMode: "opr",
      siteManagerId: managerId,
    });
    const releve = await declarer(contractId, 7, 2);
    expect(await verifyAttendance({ attendanceId: releve, verifierId: managerId, verifiedQuantity: 2 })).toEqual({ ok: true });
    expect(await closeTimeContract({ missionId, clientId })).toMatchObject({ ok: false, error: "attendance_pending", count: 1 });
  });

  it("V-P13 — la recharge d'un chantier en cours n'exige pas de responsable désigné", async () => {
    const { contractId } = await contrat({
      rate: 7_500,
      maxQuantity: 20,
      maxAmount: 150_000,
      validationMode: "opr",
      siteManagerId: managerId,
    });
    // Le responsable est retiré en cours de chantier : la recharge reste ouverte (seule la mise sous
    // séquestre INITIALE exige un responsable). Ici rien n'est dû, donc rien à recharger.
    await prisma.prestationContract.update({ where: { id: contractId }, data: { siteManagerId: null } });
    const res = await requestRecharge(contractId);
    expect(res).toMatchObject({ ok: false, error: "nothing_to_recharge" });
    // …et l'initial, lui, serait refusé : la différence est bien voulue.
    expect(await requestContractHold(contractId)).toMatchObject({ ok: false, error: "site_manager_required" });
  });
});
