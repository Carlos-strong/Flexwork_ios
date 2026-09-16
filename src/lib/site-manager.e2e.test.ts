/**
 * Responsable de chantier — délégation du constat de présence (2026-09-14, §8 du prompt S2).
 *
 * Ce rôle introduit la seule délégation de pouvoir de la plateforme : le client confie à un tiers
 * le droit de déclencher des paiements en constatant une présence. Ce qui compte n'est donc pas
 * ce qu'il PEUT faire, mais ce qu'il ne peut pas :
 *
 *   - un compte `responsable_chantier` NON désigné ne peut rien, sur aucun contrat ;
 *   - le prestataire ne peut jamais constater ses propres heures, quel que soit son rôle ;
 *   - la délégation est révocable, et une révocation reprend le pouvoir immédiatement.
 *
 * C'est pour cela que la désignation vit sur le CONTRAT et non sur le compte : un pouvoir attaché
 * au rôle serait impossible à retirer sans supprimer le compte de la personne.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { requestContractHold } from "@/lib/escrow";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { approveAttendance, canValidateAttendance, rejectAttendance, submitAttendance } from "@/lib/spot-time-actions";
import { dayPeriod } from "@/lib/spot-time";

const RUN = Date.now();
const TARIF = 7_500;
const PLAFOND = TARIF * 20;

let clientId = "";
let providerId = "";
let managerId = "";
let autreManagerId = "";
let missionId = "";
let contractId = "";

const jour = (n: number) => dayPeriod(new Date(Date.UTC(2026, 9, n)));

async function declare(n: number, quantite = 1) {
  const res = await submitAttendance({
    contractId,
    workerId: providerId,
    ...jour(n),
    declaredQuantity: quantite,
  });
  if (!res.ok) throw new Error(`soumission attendue: ${res.error}`);
  return res.attendanceId;
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const mk = (suffix: string, role: string, n: number) =>
    prisma.user.create({
      data: {
        email: `e2e-rc-${suffix}-${RUN}@flexwork.test`,
        tel: `+229${RUN}9${n}`,
        role: role as "client",
        status: "active",
        country: "BJ",
      },
    });

  const [c, p, m, m2] = await Promise.all([
    mk("client", "client", 0),
    mk("worker", "manoeuvre", 1),
    mk("manager", "responsable_chantier", 2),
    mk("manager2", "responsable_chantier", 3),
  ]);
  clientId = c.id;
  providerId = p.id;
  managerId = m.id;
  autreManagerId = m2.id;

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Chantier délégué ${RUN}`,
      description: "Chantier avec responsable désigné.",
      domaine: "batiment",
      budget: PLAFOND,
      currency: "XOF",
      delaiJours: 30,
      riskLevel: "low",
      status: "contrat_signe",
      financingModeKey: "S2J",
    },
  });
  missionId = mission.id;

  const contract = await prisma.prestationContract.create({
    data: {
      missionId,
      clientId,
      providerId,
      termsSnapshot: { prix: PLAFOND, devise: "XOF" },
      currentHash: `hash-rc-${RUN}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      spotTimeTerms: {
        create: { rateUnit: "day", rate: TARIF, maxQuantity: 20, maxAmount: PLAFOND },
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
  await prisma.user.deleteMany({
    where: { id: { in: [clientId, providerId, managerId, autreManagerId] } },
  });
});

describe("canValidateAttendance — la règle d'autorisation, isolée", () => {
  const contrat = (siteManagerId: string | null) => ({ clientId: "client-1", spotTimeTerms: { siteManagerId } });

  it("le client valide toujours", () => {
    expect(canValidateAttendance(contrat(null), "client-1")).toBe(true);
  });

  it("le responsable DÉSIGNÉ valide", () => {
    expect(canValidateAttendance(contrat("rc-1"), "rc-1")).toBe(true);
  });

  it("un responsable NON désigné ne valide pas — le rôle seul n'ouvre aucun droit", () => {
    expect(canValidateAttendance(contrat("rc-1"), "rc-2")).toBe(false);
    expect(canValidateAttendance(contrat(null), "rc-1")).toBe(false);
  });

  it("un contrat sans conditions au temps n'autorise que le client", () => {
    expect(canValidateAttendance({ clientId: "client-1" }, "client-1")).toBe(true);
    expect(canValidateAttendance({ clientId: "client-1" }, "rc-1")).toBe(false);
  });
});

describe("délégation de bout en bout", () => {
  it("avant désignation, le responsable ne peut RIEN valider", async () => {
    const id = await declare(1);
    expect(
      await approveAttendance({ attendanceId: id, validatorId: managerId, approvedQuantity: 1 })
    ).toEqual({ ok: false, error: "not_found" });

    // Le relevé n'a pas bougé : aucune créance, aucun versement.
    expect((await prisma.attendance.findUniqueOrThrow({ where: { id } })).status).toBe("submitted");
    expect(await prisma.payable.count({ where: { contractId } })).toBe(0);
  });

  it("une fois désigné, il valide et libère les fonds", async () => {
    await prisma.spotTimeTerms.update({ where: { contractId }, data: { siteManagerId: managerId } });

    const releve = await prisma.attendance.findFirstOrThrow({ where: { contractId, status: "submitted" } });
    const res = await approveAttendance({
      attendanceId: releve.id,
      validatorId: managerId,
      approvedQuantity: 1,
    });
    expect(res).toMatchObject({ ok: true, amount: TARIF, released: TARIF });

    // La créance existe, et elle porte le relevé comme source.
    const payable = await prisma.payable.findFirstOrThrow({ where: { contractId } });
    expect(payable).toMatchObject({ sourceType: "attendance", sourceId: releve.id });
  });

  it("un AUTRE responsable chantier, non désigné sur ce contrat, ne peut rien", async () => {
    const id = await declare(2);
    expect(
      await approveAttendance({ attendanceId: id, validatorId: autreManagerId, approvedQuantity: 1 })
    ).toEqual({ ok: false, error: "not_found" });
    expect(
      await rejectAttendance({ attendanceId: id, validatorId: autreManagerId, reason: "non" })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("le PRESTATAIRE ne peut jamais constater ses propres heures", async () => {
    const releve = await prisma.attendance.findFirstOrThrow({ where: { contractId, status: "submitted" } });
    expect(
      await approveAttendance({ attendanceId: releve.id, validatorId: providerId, approvedQuantity: 1 })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("le client conserve son pouvoir malgré la délégation — il ne l'a pas cédé", async () => {
    const releve = await prisma.attendance.findFirstOrThrow({ where: { contractId, status: "submitted" } });
    expect(
      await approveAttendance({ attendanceId: releve.id, validatorId: clientId, approvedQuantity: 1 })
    ).toMatchObject({ ok: true });
  });

  it("la révocation reprend le pouvoir IMMÉDIATEMENT", async () => {
    await prisma.spotTimeTerms.update({ where: { contractId }, data: { siteManagerId: null } });

    const id = await declare(3);
    expect(
      await approveAttendance({ attendanceId: id, validatorId: managerId, approvedQuantity: 1 })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("les relevés déjà validés par un responsable révoqué restent valides", async () => {
    // Une validation passée était légitime au moment où elle a eu lieu, et l'argent est parti.
    // La défaire rouvrirait un paiement déjà exécuté.
    const valides = await prisma.attendance.count({ where: { contractId, status: "approved" } });
    expect(valides).toBeGreaterThanOrEqual(2);
  });
});
