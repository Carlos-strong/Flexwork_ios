/**
 * Contrat au TEMPS de bout en bout (§9 à §13, §19, §21 — mode S2-J).
 *
 * Rejoue l'artisan journalier du §10 : 7 500 FCFA/jour, 20 jours maximum, 150 000 séquestrés
 * avant le démarrage. Puis le §11 : 4 jours validés → 30 000 libérables → solde 120 000.
 *
 * Ce que ce fichier verrouille avant tout, c'est la phrase du §20 : « le pointage n'a AUCUN
 * pouvoir financier direct ». Un relevé soumis ne doit rien déclencher ; seule la validation du
 * CLIENT produit une créance, et seule la couverture du séquestre produit une instruction.
 *
 * Mode CONSOLE (pas d'autoconfirm) : il faut pouvoir observer l'effet de la confirmation du
 * financement séparément de son instruction.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { escrowBalance, requestContractHold } from "@/lib/escrow";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import {
  approveAttendance,
  disputeAttendance,
  rejectAttendance,
  resolveAttendanceDispute,
  submitAttendance,
} from "@/lib/spot-time-actions";
import { dayPeriod, fundingAlert } from "@/lib/spot-time";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-temps-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-temps-provider-${RUN}@flexwork.test`;

const TARIF = 7_500;
const MAX_JOURS = 20;
const PLAFOND = TARIF * MAX_JOURS; // 150 000

let clientId = "";
let providerId = "";
let missionId = "";
let contractId = "";

const jour = (n: number) => dayPeriod(new Date(Date.UTC(2026, 8, n)));

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}80`, role: "client", status: "active", country: "BJ" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}81`, role: "artisan", status: "active", country: "BJ" },
  });
  clientId = client.id;
  providerId = provider.id;

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Chantier — maçon journalier ${RUN}`,
      description: "Renfort de chantier rémunéré à la journée.",
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
      currentHash: `hash-temps-${RUN}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      spotTimeTerms: {
        create: { rateUnit: "day", rate: TARIF, maxQuantity: MAX_JOURS, maxAmount: PLAFOND },
      },
    },
  });
  contractId = contract.id;
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

describe("§10 — le plafond est séquestré avant le démarrage", () => {
  it("le client finance 20 × 7 500 = 150 000 en une fois", async () => {
    const res = await requestContractHold(contractId);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.operation.amount).toBe(PLAFOND);

    expect((await operateVirtualPsp("authorize", res.operation.pspReference!)).ok).toBe(true);
    expect((await escrowBalance(contractId)).available).toBe(PLAFOND);
  });
});

describe("§20 — le pointage n'a aucun pouvoir financier direct", () => {
  it("un relevé SOUMIS ne libère rien et ne crée aucune créance", async () => {
    const p = jour(1);
    const res = await submitAttendance({
      contractId,
      workerId: providerId,
      ...p,
      declaredQuantity: 4,
    });
    expect(res.ok).toBe(true);

    // Rien n'a bougé : ni créance, ni instruction, ni solde.
    expect(await prisma.payable.count({ where: { contractId } })).toBe(0);
    expect((await escrowBalance(contractId)).available).toBe(PLAFOND);
  });

  it("le prestataire ne peut pas valider son propre relevé", async () => {
    const releve = await prisma.attendance.findFirstOrThrow({ where: { contractId } });
    expect(
      await approveAttendance({
        attendanceId: releve.id,
        validatorId: providerId,
        approvedQuantity: 4,
      })
    ).toEqual({ ok: false, error: "not_found" });
  });

  it("§11 — la validation du CLIENT libère 30 000 et ramène le solde à 120 000", async () => {
    const releve = await prisma.attendance.findFirstOrThrow({ where: { contractId } });
    const res = await approveAttendance({
      attendanceId: releve.id,
      validatorId: clientId,
      approvedQuantity: 4,
    });
    expect(res).toMatchObject({ ok: true, amount: 30_000, released: 30_000 });

    const b = await escrowBalance(contractId);
    expect(b.held).toBe(120_000);
    expect(b.released).toBe(30_000);

    // La créance porte le RELEVÉ comme source : c'est par elle qu'on remonte d'un paiement à la
    // journée qui l'a justifié.
    const payable = await prisma.payable.findFirstOrThrow({ where: { contractId } });
    expect(payable).toMatchObject({ sourceType: "attendance", sourceId: releve.id, amount: 30_000 });
  });
});

describe("double pointage — ce que le système refuse", () => {
  it("un second relevé sur la MÊME journée est refusé", async () => {
    const res = await submitAttendance({
      contractId,
      workerId: providerId,
      ...jour(1),
      declaredQuantity: 2,
    });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(["duplicate_period", "period_overlap"]).toContain(res.error);
  });

  it("un relevé qui CHEVAUCHE partiellement est refusé", async () => {
    // Aucune contrainte d'unicité n'attraperait ce cas : les bornes diffèrent.
    const res = await submitAttendance({
      contractId,
      workerId: providerId,
      periodStart: new Date(Date.UTC(2026, 8, 1, 10)),
      periodEnd: new Date(Date.UTC(2026, 8, 2, 10)),
      declaredQuantity: 1,
    });
    expect(res).toEqual({ ok: false, error: "period_overlap" });
  });

  it("une quantité nulle est refusée", async () => {
    expect(
      await submitAttendance({ contractId, workerId: providerId, ...jour(9), declaredQuantity: 0 })
    ).toEqual({ ok: false, error: "invalid_quantity" });
  });
});

describe("§21 — validation partielle : le reste demeure au séquestre", () => {
  it("6 jours déclarés, 4 validés : seuls 4 sont payés, 2 restent séquestrés", async () => {
    const submitted = await submitAttendance({
      contractId,
      workerId: providerId,
      ...jour(2),
      declaredQuantity: 6,
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;

    const avant = await escrowBalance(contractId);
    const res = await approveAttendance({
      attendanceId: submitted.attendanceId,
      validatorId: clientId,
      approvedQuantity: 4,
    });
    expect(res).toMatchObject({ ok: true, amount: 30_000 });

    const apres = await escrowBalance(contractId);
    // Les 2 jours non validés ne sont ni versés, ni perdus : ils restent au séquestre.
    expect(apres.held).toBe(avant.held - 30_000);

    const releve = await prisma.attendance.findUniqueOrThrow({ where: { id: submitted.attendanceId } });
    expect(releve).toMatchObject({ declaredQuantity: 6, approvedQuantity: 4, status: "approved" });
  });

  it("valider PLUS que déclaré est refusé", async () => {
    const submitted = await submitAttendance({
      contractId,
      workerId: providerId,
      ...jour(3),
      declaredQuantity: 1,
    });
    if (!submitted.ok) throw new Error("soumission attendue");
    expect(
      await approveAttendance({
        attendanceId: submitted.attendanceId,
        validatorId: clientId,
        approvedQuantity: 3,
      })
    ).toMatchObject({ ok: false, error: "approved_above_declared" });
  });

  it("un refus motivé ne paie rien et libère la période", async () => {
    const releve = await prisma.attendance.findFirstOrThrow({
      where: { contractId, status: "submitted" },
    });
    const avant = await escrowBalance(contractId);
    expect(await rejectAttendance({ attendanceId: releve.id, validatorId: clientId, reason: "Absent l'après-midi" })).toEqual({ ok: true });
    expect((await escrowBalance(contractId)).held).toBe(avant.held);

    // La journée refusée peut être redéclarée — une erreur de saisie ne la condamne pas.
    const rejoue = await submitAttendance({
      contractId,
      workerId: providerId,
      ...jour(3),
      declaredQuantity: 0.5,
    });
    expect(rejoue.ok).toBe(true);
  });
});

describe("plafonds et alerte de financement", () => {
  it("dépasser le plafond de jours est refusé, avec le reliquat annoncé", async () => {
    const submitted = await submitAttendance({
      contractId,
      workerId: providerId,
      ...jour(10),
      declaredQuantity: 19,
    });
    if (!submitted.ok) throw new Error("soumission attendue");

    const res = await approveAttendance({
      attendanceId: submitted.attendanceId,
      validatorId: clientId,
      approvedQuantity: 19,
    });
    expect(res).toMatchObject({ ok: false, error: "quantity_cap_exceeded" });
    // 8 jours déjà validés (4 + 4) sur 20 : il en reste 12.
    if (!res.ok) expect(res.allowed).toBe(12);
  });

  it("§19 — l'alerte annonce combien de jours le séquestre couvre encore", async () => {
    const b = await escrowBalance(contractId);
    const alerte = fundingAlert(
      { rateUnit: "day", rate: TARIF, maxQuantity: MAX_JOURS, maxAmount: PLAFOND, overtimeAllowed: false, overtimeRate: null },
      b.available
    );
    expect(alerte.remainingUnits).toBe(Math.floor(b.available / TARIF));
  });
});

describe("§21 — contester gèle la part discutée, sans la faire sortir", () => {
  it("6 jours déclarés, 4 reconnus, 2 contestés : 4 payés, 2 GELÉS", async () => {
    const submitted = await submitAttendance({
      contractId,
      workerId: providerId,
      ...jour(20),
      declaredQuantity: 6,
    });
    if (!submitted.ok) throw new Error("soumission attendue");

    const avant = await escrowBalance(contractId);
    const res = await disputeAttendance({
      attendanceId: submitted.attendanceId,
      validatorId: clientId,
      approvedQuantity: 4,
      reason: "Deux journées non constatées sur site",
    });
    expect(res).toMatchObject({ ok: true, paid: 4 * TARIF, frozen: 2 * TARIF });

    const apres = await escrowBalance(contractId);
    // Les 4 jours reconnus sont SORTIS du séquestre.
    expect(apres.held).toBe(avant.held - 4 * TARIF);
    // Les 2 contestés y sont TOUJOURS — mais indisponibles. C'est tout le point du §21 :
    // ni versés au prestataire, ni rendus au client.
    expect(apres.blocked).toBe(2 * TARIF);
    expect(apres.available).toBe(apres.held - 2 * TARIF);

    const releve = await prisma.attendance.findUniqueOrThrow({ where: { id: submitted.attendanceId } });
    expect(releve).toMatchObject({ status: "disputed", approvedQuantity: 4, declaredQuantity: 6 });
  });

  it("contester sans motif est refusé", async () => {
    const submitted = await submitAttendance({
      contractId,
      workerId: providerId,
      ...jour(21),
      declaredQuantity: 2,
    });
    if (!submitted.ok) throw new Error("soumission attendue");
    expect(
      await disputeAttendance({
        attendanceId: submitted.attendanceId,
        validatorId: clientId,
        approvedQuantity: 1,
        reason: "   ",
      })
    ).toEqual({ ok: false, error: "dispute_reason_required" });
  });

  it("« contester » la totalité reconnue n'est pas une contestation", async () => {
    const releve = await prisma.attendance.findFirstOrThrow({
      where: { contractId, status: "submitted" },
    });
    expect(
      await disputeAttendance({
        attendanceId: releve.id,
        validatorId: clientId,
        approvedQuantity: releve.declaredQuantity,
        reason: "motif",
      })
    ).toEqual({ ok: false, error: "nothing_disputed" });
  });

  it("arbitrer EN FAVEUR du prestataire dégèle et paie la part contestée", async () => {
    const litige = await prisma.attendance.findFirstOrThrow({
      where: { contractId, status: "disputed" },
    });
    const avant = await escrowBalance(contractId);
    expect(avant.blocked).toBe(2 * TARIF);

    const res = await resolveAttendanceDispute({
      attendanceId: litige.id,
      validatorId: clientId,
      accept: true,
    });
    expect(res).toMatchObject({ ok: true });

    const apres = await escrowBalance(contractId);
    // Plus rien n'est gelé, et les 2 jours sont partis au prestataire.
    expect(apres.blocked).toBe(0);
    expect(apres.held).toBe(avant.held - 2 * TARIF);
    expect((await prisma.attendance.findUniqueOrThrow({ where: { id: litige.id } })).status).toBe("approved");
  });

  it("arbitrer CONTRE dégèle sans payer — les fonds redeviennent disponibles", async () => {
    const submitted = await submitAttendance({
      contractId,
      workerId: providerId,
      ...jour(22),
      declaredQuantity: 3,
    });
    if (!submitted.ok) throw new Error("soumission attendue");
    await disputeAttendance({
      attendanceId: submitted.attendanceId,
      validatorId: clientId,
      approvedQuantity: 1,
      reason: "Absence constatée",
    });

    const avant = await escrowBalance(contractId);
    expect(avant.blocked).toBe(2 * TARIF);

    const res = await resolveAttendanceDispute({
      attendanceId: submitted.attendanceId,
      validatorId: clientId,
      accept: false,
    });
    expect(res).toEqual({ ok: true, paid: 0 });

    const apres = await escrowBalance(contractId);
    expect(apres.blocked).toBe(0);
    // Rien n'est sorti : la somme écartée redevient simplement disponible, et repartira au
    // client en fin de contrat comme tout reliquat.
    expect(apres.held).toBe(avant.held);
    expect(apres.available).toBe(apres.held);
  });

  it("un litige gelé n'empêche PAS les journées suivantes d'être payées", async () => {
    // Le gel est ciblé, pas global : un chantier ne s'arrête pas parce qu'une journée est
    // discutée. C'est ce qui distingue ce gel de celui d'une médiation.
    const submitted = await submitAttendance({
      contractId,
      workerId: providerId,
      ...jour(23),
      declaredQuantity: 2,
    });
    if (!submitted.ok) throw new Error("soumission attendue");
    await disputeAttendance({
      attendanceId: submitted.attendanceId,
      validatorId: clientId,
      approvedQuantity: 0,
      reason: "À vérifier",
    });
    expect((await escrowBalance(contractId)).blocked).toBe(2 * TARIF);

    const suivant = await submitAttendance({
      contractId,
      workerId: providerId,
      ...jour(24),
      declaredQuantity: 1,
    });
    if (!suivant.ok) throw new Error("soumission attendue");
    expect(
      await approveAttendance({
        attendanceId: suivant.attendanceId,
        validatorId: clientId,
        approvedQuantity: 1,
      })
    ).toMatchObject({ ok: true, released: TARIF });
  });
});
