/**
 * Responsable de chantier — mode de vérification OPR (2026-09-14, refondu le 2026-10-01).
 *
 * Depuis le choix « Vérification / validation » posé à la publication, le responsable ne VALIDE
 * plus : il VÉRIFIE et TRANSMET, et le client prononce seul la validation définitive — donc la
 * libération des fonds. Ce qui compte reste ce qu'il ne peut pas faire :
 *
 *   - un compte `responsable_chantier` NON désigné ne peut rien, sur aucun contrat ;
 *   - le responsable désigné ne libère jamais de fonds lui-même ;
 *   - en OPR strict, le client ne valide pas un relevé que le responsable n'a pas vérifié ;
 *   - le prestataire ne peut jamais constater ses propres heures ;
 *   - la désignation est révocable, et une révocation retire le pouvoir immédiatement.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { escrowBalance, requestContractHold } from "@/lib/escrow";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import {
  approveAttendance,
  canDecideAttendance,
  rejectAttendance,
  submitAttendance,
  verifyAttendance,
} from "@/lib/spot-time-actions";
import { dayPeriod } from "@/lib/spot-time";
import { canClientFinalize, canVerify, contractRole } from "@/lib/validation-mode";

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
      validationMode: "opr",
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
      // Mode OPR, responsable PAS ENCORE désigné (« plus tard »).
      validationMode: "opr",
      spotTimeTerms: {
        create: { rateUnit: "day", rate: TARIF, maxQuantity: 20, maxAmount: PLAFOND },
      },
    },
  });
  contractId = contract.id;

  // Désignation obligatoire AVANT le financement : sans responsable, le séquestre est refusé.
  const refuse = await requestContractHold(contractId);
  if (refuse.ok || refuse.error !== "site_manager_required") throw new Error("financement sans responsable accepté");
  await prisma.prestationContract.update({ where: { id: contractId }, data: { siteManagerId: managerId } });

  const hold = await requestContractHold(contractId);
  if (!hold.ok) throw new Error("financement attendu");
  await operateVirtualPsp("authorize", hold.operation.pspReference!);
});

afterAll(async () => {
  await prisma.missionNotification.deleteMany({ where: { missionId } });
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

describe("règles d'autorisation, isolées", () => {
  const contrat = (validationMode: "client" | "opr", siteManagerId: string | null) => ({
    clientId: "client-1",
    providerId: "presta-1",
    validationMode,
    siteManagerId,
  });

  it("« Moi-même » : le client vérifie, aucun responsable n'a de rôle", () => {
    expect(canVerify(contrat("client", null), "client-1")).toBe(true);
    expect(canVerify(contrat("client", "rc-1"), "rc-1")).toBe(false);
    expect(contractRole(contrat("client", "rc-1"), "rc-1")).toBeNull();
  });

  it("OPR : le responsable DÉSIGNÉ vérifie, le client ne vérifie pas", () => {
    expect(canVerify(contrat("opr", "rc-1"), "rc-1")).toBe(true);
    expect(canVerify(contrat("opr", "rc-1"), "client-1")).toBe(false);
    expect(contractRole(contrat("opr", "rc-1"), "rc-1")).toBe("site_manager");
  });

  it("un responsable NON désigné n'a aucun rôle — le rôle du compte seul n'ouvre aucun droit", () => {
    expect(canVerify(contrat("opr", "rc-1"), "rc-2")).toBe(false);
    expect(contractRole(contrat("opr", null), "rc-1")).toBeNull();
  });

  it("la décision définitive appartient au client seul", () => {
    expect(canDecideAttendance({ clientId: "client-1" }, "client-1")).toBe(true);
    expect(canDecideAttendance({ clientId: "client-1" }, "rc-1")).toBe(false);
    expect(canClientFinalize("client", null)).toBe(true);
    expect(canClientFinalize("opr", null)).toBe(false);
    expect(canClientFinalize("opr", new Date())).toBe(true);
  });
});

describe("relevés en mode OPR, de bout en bout", () => {
  it("sans responsable (retiré), personne ne vérifie — et le client ne court-circuite pas", async () => {
    await prisma.prestationContract.update({ where: { id: contractId }, data: { siteManagerId: null } });
    const id = await declare(1);
    expect(await verifyAttendance({ attendanceId: id, verifierId: managerId, verifiedQuantity: 1 })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await approveAttendance({ attendanceId: id, validatorId: clientId, approvedQuantity: 1 })).toEqual({
      ok: false,
      error: "verification_required",
    });
    expect(await prisma.payable.count({ where: { contractId } })).toBe(0);
  });

  it("le financement initial exige un responsable désigné", async () => {
    // Déjà vérifié au montage (beforeAll) ; rappelé ici pour le rapport de test.
    expect(await prisma.pspEscrowOperation.count({ where: { contractId, instructionType: "hold" } })).toBe(1);
  });

  it("une fois désigné, le responsable vérifie — sans aucun effet financier", async () => {
    await prisma.prestationContract.update({ where: { id: contractId }, data: { siteManagerId: managerId } });
    const releve = await prisma.attendance.findFirstOrThrow({ where: { contractId, status: "submitted" } });
    const avant = await escrowBalance(contractId);

    expect(await verifyAttendance({ attendanceId: releve.id, verifierId: managerId, verifiedQuantity: 1 })).toEqual({ ok: true });

    expect(await prisma.attendance.findUniqueOrThrow({ where: { id: releve.id } })).toMatchObject({
      status: "verified",
      verifiedQuantity: 1,
      verifiedById: managerId,
    });
    expect(await prisma.payable.count({ where: { contractId } })).toBe(0);
    expect((await escrowBalance(contractId)).held).toBe(avant.held);
  });

  it("le responsable ne valide JAMAIS définitivement", async () => {
    const releve = await prisma.attendance.findFirstOrThrow({ where: { contractId, status: "verified" } });
    expect(await approveAttendance({ attendanceId: releve.id, validatorId: managerId, approvedQuantity: 1 })).toEqual({
      ok: false,
      error: "verification_only",
    });
  });

  it("le client valide définitivement la quantité vérifiée — et c'est là que les fonds partent", async () => {
    const releve = await prisma.attendance.findFirstOrThrow({ where: { contractId, status: "verified" } });
    // La quantité envoyée est ignorée en OPR : c'est la quantité vérifiée qui fait foi.
    const res = await approveAttendance({ attendanceId: releve.id, validatorId: clientId, approvedQuantity: 99 });
    expect(res).toMatchObject({ ok: true, amount: TARIF, released: TARIF });
    const payable = await prisma.payable.findFirstOrThrow({ where: { contractId } });
    expect(payable).toMatchObject({ sourceType: "attendance", sourceId: releve.id });
  });

  it("le client ne vérifie pas lui-même en OPR", async () => {
    const id = await declare(2);
    expect(await verifyAttendance({ attendanceId: id, verifierId: clientId, verifiedQuantity: 1 })).toEqual({
      ok: false,
      error: "site_manager_only",
    });
  });

  it("un AUTRE responsable, non désigné sur ce contrat, ne peut rien", async () => {
    const releve = await prisma.attendance.findFirstOrThrow({ where: { contractId, status: "submitted" } });
    expect(await verifyAttendance({ attendanceId: releve.id, verifierId: autreManagerId, verifiedQuantity: 1 })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await rejectAttendance({ attendanceId: releve.id, validatorId: autreManagerId, reason: "non" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("le PRESTATAIRE ne peut jamais constater ses propres heures", async () => {
    const releve = await prisma.attendance.findFirstOrThrow({ where: { contractId, status: "submitted" } });
    expect(await verifyAttendance({ attendanceId: releve.id, verifierId: providerId, verifiedQuantity: 1 })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await approveAttendance({ attendanceId: releve.id, validatorId: providerId, approvedQuantity: 1 })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("le responsable peut refuser un relevé non conforme ; le client refuse ce qui lui est transmis", async () => {
    const soumis = await prisma.attendance.findFirstOrThrow({ where: { contractId, status: "submitted" } });
    expect(await rejectAttendance({ attendanceId: soumis.id, validatorId: managerId, reason: "Absent ce jour-là" })).toEqual({ ok: true });

    const id = await declare(3);
    // Le client ne refuse pas un relevé que le responsable n'a pas encore vu.
    expect(await rejectAttendance({ attendanceId: id, validatorId: clientId, reason: "non" })).toEqual({
      ok: false,
      error: "verification_required",
    });
    await verifyAttendance({ attendanceId: id, verifierId: managerId, verifiedQuantity: 1 });
    expect(await rejectAttendance({ attendanceId: id, validatorId: clientId, reason: "Désaccord avec le constat" })).toEqual({ ok: true });
  });

  it("la révocation retire le pouvoir IMMÉDIATEMENT", async () => {
    await prisma.prestationContract.update({ where: { id: contractId }, data: { siteManagerId: null } });
    const id = await declare(4);
    expect(await verifyAttendance({ attendanceId: id, verifierId: managerId, verifiedQuantity: 1 })).toEqual({
      ok: false,
      error: "not_found",
    });
  });

  it("les relevés déjà validés restent valides après la révocation", async () => {
    // Une validation passée était légitime au moment où elle a eu lieu, et l'argent est parti.
    expect(await prisma.attendance.count({ where: { contractId, status: "approved" } })).toBe(1);
  });
});
