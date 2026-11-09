/**
 * Mode de pointage « validation totale » (2026-10-01) — de bout en bout sur un contrat au temps
 * financé : le client ne peut pas réduire un relevé en silence. Il le constate en entier, le
 * refuse avec un motif, ou en conteste une partie (gel + arbitrage). Le contrat de référence
 * (spot-time.e2e.test.ts) reste en « partielle », comportement historique.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { escrowBalance, requestContractHold } from "@/lib/escrow";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { approveAttendance, disputeAttendance, rejectAttendance, submitAttendance } from "@/lib/spot-time-actions";
import { dayPeriod } from "@/lib/spot-time";
import { givePayoutAccount } from "@/test/payout-fixture";
import { releaseAwaitingPayouts } from "@/lib/payout-release";

const RUN = Date.now();
const TARIF = 7_500;
const MAX_JOURS = 20;
const PLAFOND = TARIF * MAX_JOURS; // 150 000

let clientId = "";
let providerId = "";
let missionId = "";
let contractId = "";

const jour = (n: number) => dayPeriod(new Date(Date.UTC(2026, 9, n)));

async function declarer(n: number, declaredQuantity: number): Promise<string> {
  const res = await submitAttendance({ contractId, workerId: providerId, ...jour(n), declaredQuantity });
  if (!res.ok) throw new Error(`déclaration refusée : ${res.error}`);
  return res.attendanceId;
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: `e2e-pointage-client-${RUN}@flexwork.test`, tel: `+229${RUN}90`, role: "client", status: "active", country: "BJ" },
  });
  const provider = await prisma.user.create({
    data: { email: `e2e-pointage-provider-${RUN}@flexwork.test`, tel: `+229${RUN}91`, role: "artisan", status: "active", country: "BJ" },
  });
  clientId = client.id;
  providerId = provider.id;
  await givePayoutAccount(providerId);

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Chantier — validation totale ${RUN}`,
      description: "Renfort de chantier rémunéré à la journée, relevés validés en entier.",
      domaine: "batiment",
      budget: PLAFOND,
      currency: "XOF",
      delaiJours: 30,
      riskLevel: "low",
      status: "contrat_signe",
      financingModeKey: "S2J",
      attendanceValidation: "totale",
    },
  });
  missionId = mission.id;

  const contract = await prisma.prestationContract.create({
    data: {
      missionId,
      clientId,
      providerId,
      termsSnapshot: { prix: PLAFOND, devise: "XOF" },
      currentHash: `hash-pointage-${RUN}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      spotTimeTerms: {
        create: { rateUnit: "day", rate: TARIF, maxQuantity: MAX_JOURS, maxAmount: PLAFOND, attendanceValidation: "totale" },
      },
    },
  });
  contractId = contract.id;

  const hold = await requestContractHold(contractId);
  if (!hold.ok) throw new Error("financement attendu");
  await operateVirtualPsp("authorize", hold.operation.pspReference!);
});

afterAll(async () => {
  await prisma.attendance.deleteMany({ where: { contractId } });
  await prisma.payable.deleteMany({ where: { contractId } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId } });
  await prisma.spotTimeTerms.deleteMany({ where: { contractId } });
  await prisma.prestationContract.deleteMany({ where: { id: contractId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("mode de pointage « validation totale »", () => {
  it("une validation partielle est refusée, et ne paie rien", async () => {
    const releve = await declarer(1, 6);
    const avant = await escrowBalance(contractId);
    expect(await approveAttendance({ attendanceId: releve, validatorId: clientId, approvedQuantity: 4 })).toEqual({
      ok: false,
      error: "partial_validation_not_allowed",
    });
    expect((await escrowBalance(contractId)).held).toBe(avant.held);
    expect(await prisma.attendance.findUniqueOrThrow({ where: { id: releve } })).toMatchObject({ status: "submitted" });
  });

  it("le même relevé validé en entier est payé en entier", async () => {
    const releve = await prisma.attendance.findFirstOrThrow({ where: { contractId, status: "submitted" } });
    const res = await approveAttendance({ attendanceId: releve.id, validatorId: clientId, approvedQuantity: 6 });
    expect(res).toMatchObject({ ok: true, amount: 6 * TARIF });
  });

  it("un relevé inexact se refuse avec un motif, puis se redéclare corrigé", async () => {
    const releve = await declarer(2, 3);
    expect(await rejectAttendance({ attendanceId: releve, validatorId: clientId, reason: "Deux jours seulement sur site" })).toEqual({ ok: true });
    const corrige = await declarer(2, 2);
    expect(await approveAttendance({ attendanceId: corrige, validatorId: clientId, approvedQuantity: 2 })).toMatchObject({
      ok: true,
      amount: 2 * TARIF,
    });
  });

  it("la contestation reste ouverte : part reconnue payée, part contestée gelée", async () => {
    const releve = await declarer(3, 5);
    const res = await disputeAttendance({
      attendanceId: releve,
      validatorId: clientId,
      approvedQuantity: 3,
      reason: "Deux journées non constatées sur site",
    });
    expect(res).toMatchObject({ ok: true, paid: 3 * TARIF, frozen: 2 * TARIF });
    expect((await escrowBalance(contractId)).blocked).toBe(2 * TARIF);
  });

  it("la part reconnue du relevé contesté compte dans le cumul : le relevé suivant est payé", async () => {
    // Régression (2026-11-02) : le cumul n'additionnait que les relevés « approved ». La part
    // reconnue du relevé contesté, déjà versée, en sortait — la cible cumulée tombait sous le
    // versé et le relevé suivant échouait en `nothing_to_release`.
    const releve = await declarer(5, 1);
    expect(await approveAttendance({ attendanceId: releve, validatorId: clientId, approvedQuantity: 1 })).toMatchObject({
      ok: true,
      released: TARIF,
    });
  });
});

describe("compte de versement non vérifié (politique KYC, 2026-11-02)", () => {
  it("le relevé est approuvé et sa créance reste due ; elle part à la vérification du compte", async () => {
    await prisma.payoutAccount.update({ where: { userId: providerId }, data: { status: "en_attente" } });
    try {
      const releve = await declarer(4, 1);
      expect(await approveAttendance({ attendanceId: releve, validatorId: clientId, approvedQuantity: 1 })).toEqual({
        ok: false,
        error: "payout_unverified",
      });
      const approuve = await prisma.attendance.findUniqueOrThrow({ where: { id: releve } });
      expect(approuve.status).toBe("approved");
      const payable = await prisma.payable.findUniqueOrThrow({ where: { id: approuve.payableId! } });
      expect(payable).toMatchObject({ status: "validated", amount: TARIF, escrowOperationId: null });

      await prisma.payoutAccount.update({ where: { userId: providerId }, data: { status: "verifie" } });
      expect((await releaseAwaitingPayouts(providerId)).instructed).toBe(1);
      expect((await prisma.payable.findUniqueOrThrow({ where: { id: payable.id } })).status).toBe("instructed");
    } finally {
      await prisma.payoutAccount.update({ where: { userId: providerId }, data: { status: "verifie" } });
    }
  });
});
