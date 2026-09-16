/**
 * WORKFLOW COMPLET — suite : modes restants et incidents (2026-09-15).
 *
 * `workflow-complet.e2e.test.ts` traverse F2, J4, S1, S2J et une médiation. Ce fichier traverse,
 * par les mêmes VRAIES routes, tout ce qu'il ne couvre pas — en particulier les chemins touchés par
 * les dernières corrections (découpage des jalons en prix fixe, réinstruction des créances) :
 *
 *   W1  J1 prix fixe — refus du PSP sur un versement, reprise par revalidation du client
 *   W2  J3 prix fixe — paliers de progression 50 % puis 100 %
 *   W3  J1 sur VRAI devis — jalons dérivés des lignes du devis, sans ressaisie
 *   W4  S2H — refus PSP et réinstruction admin, gel, insuffisance, recharge, reprise AUTOMATIQUE,
 *             arbitrage, clôture
 *   W5  S2M — relevé mensuel, clôture et reliquat
 *   W6  Acceptation tacite — le client se tait, le délai paie
 *   W7  Mission arrêtée — solde de retenue et remboursement par l'administration
 *   W8  Commande Gig — achat, signatures, séquestre, validation, versement
 *   W9  Console admin et journal PSP sur l'ensemble
 *
 * Règles d'or et identité comptable après chaque mouvement. PSP virtuelle en mode console.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as missionPost } from "@/app/api/missions/route";
import { POST as proposalPost } from "@/app/api/missions/[id]/proposals/route";
import { POST as acceptPost } from "@/app/api/missions/[id]/proposals/[proposalId]/accept/route";
import { POST as devisPost } from "@/app/api/missions/[id]/devis/route";
import { POST as devisValidatePost } from "@/app/api/missions/[id]/proposals/[proposalId]/devis/validate/route";
import { POST as contractPost } from "@/app/api/missions/[id]/contract/route";
import { POST as certPost } from "@/app/api/signature/certificate/route";
import { POST as signPost } from "@/app/api/signature/sign/route";
import { POST as escrowHoldPost } from "@/app/api/missions/[id]/escrow/hold/route";
import { GET as rechargeGet, POST as rechargePost } from "@/app/api/missions/[id]/escrow/recharge/route";
import { POST as jalonHoldPost } from "@/app/api/missions/[id]/jalons/[jalonId]/hold/route";
import { POST as jalonDeliverablePost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/route";
import { POST as jalonSubmitPost } from "@/app/api/missions/[id]/jalons/[jalonId]/submit/route";
import { POST as jalonObservePost } from "@/app/api/missions/[id]/jalons/[jalonId]/observe-progress/route";
import { POST as jalonValidatePost } from "@/app/api/missions/[id]/jalons/[jalonId]/validate/route";
import { POST as jalonCheckpointPost } from "@/app/api/missions/[id]/jalons/[jalonId]/checkpoint/route";
import { POST as appreciatePost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/[attachmentId]/appreciate/route";
import { POST as attendancePost } from "@/app/api/missions/[id]/attendance/route";
import { POST as attendanceDecisionPost } from "@/app/api/missions/[id]/attendance/[attendanceId]/route";
import { POST as timeClosePost } from "@/app/api/missions/[id]/time-contract/close/route";
import { POST as adminRefundPost } from "@/app/api/admin/contracts/[contractId]/refund/route";
import { POST as retentionSettlePost } from "@/app/api/admin/contracts/[contractId]/retention/settle/route";
import { POST as reinstructPost } from "@/app/api/admin/finance/payables/[payableId]/reinstruct/route";
import { GET as financeGet } from "@/app/api/admin/finance/route";
import { POST as gigPost } from "@/app/api/gigs/route";
import { POST as gigPurchasePost } from "@/app/api/gigs/[id]/purchase/route";
import { POST as gigSignPost } from "@/app/api/gigs/orders/[orderId]/sign/route";
import { POST as gigValidatePost } from "@/app/api/gigs/orders/[orderId]/validate/route";
import { prisma } from "@/lib/db";
import { escrowBalance, type EscrowBalance } from "@/lib/escrow";
import { checkEscrowInvariants } from "@/lib/escrow-invariants";
import { gigHeldBalance } from "@/lib/gig-completion";
import { operateVirtualPsp, type VirtualPspAction } from "@/lib/psp-virtual";
import { runTacitAcceptanceSweep } from "@/lib/tacit-acceptance";
import type { Anomaly, ContractFinanceRow } from "@/lib/admin-finance";

const RUN = Date.now();
const PASSPHRASE = "passphrase-incidents-2026";
const LONG = 120_000;
const DAY = 24 * 60 * 60 * 1000;

const ids = { client: "", provider: "", mediator: "", supervisor: "", clientCert: "", providerCert: "" };
const missionIds: string[] = [];
const contractIds: string[] = [];
const gig = { gigId: "", orderId: "" };
const report: Record<string, unknown>[] = [];

// ── Outils ────────────────────────────────────────────────────────────────────────────────────

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}

const postReq = (body: unknown) =>
  new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const getReq = () => new Request("http://localhost/api");
const at = (id: string) => ({ params: Promise.resolve({ id }) });
const atJalon = (id: string, jalonId: string) => ({ params: Promise.resolve({ id, jalonId }) });
const atAttendance = (id: string, attendanceId: string) => ({ params: Promise.resolve({ id, attendanceId }) });

function proofForm(): Request {
  const fd = new FormData();
  fd.append("category", "other");
  fd.append("note", "Preuve de réalisation — incidents");
  return new Request("http://localhost/api", { method: "POST", body: fd });
}

async function expectOk(res: Response, label: string, codes = [200, 201]) {
  if (!codes.includes(res.status)) throw new Error(`${label} → HTTP ${res.status} : ${await res.clone().text()}`);
  return res;
}

const ACTION: Record<string, VirtualPspAction> = {
  hold: "authorize",
  release: "release",
  retention_release: "release",
  refund: "refund",
  freeze: "freeze",
  unfreeze: "unfreeze",
};

async function pspConfirmsPending(contractId: string, types?: string[]): Promise<string[]> {
  const ops = await prisma.pspEscrowOperation.findMany({
    where: { contractId, status: "pending", ...(types ? { instructionType: { in: types as never } } : {}) },
    orderBy: [{ instructionSentAt: "asc" }, { id: "asc" }],
  });
  for (const op of ops) {
    expect(await operateVirtualPsp(ACTION[op.instructionType], op.pspReference!), `${op.instructionType} ${op.amount}`).toMatchObject({ ok: true });
  }
  return ops.map((o) => o.instructionType);
}

async function pspRefusesPending(contractId: string, type: string) {
  const op = await prisma.pspEscrowOperation.findFirstOrThrow({ where: { contractId, status: "pending", instructionType: type as never } });
  expect(await operateVirtualPsp("fail", op.pspReference!)).toMatchObject({ ok: true });
  return op;
}

async function goldenRules(contractId: string): Promise<EscrowBalance> {
  expect(await checkEscrowInvariants(contractId)).toEqual([]);
  const b = await escrowBalance(contractId);
  expect(Math.abs(b.funded - (b.released + b.refunded + b.held))).toBeLessThan(0.01);
  return b;
}

async function publish(body: Record<string, unknown>) {
  authAs(ids.client);
  const res = await expectOk(
    await missionPost(
      postReq({
        description: "Mission du test de workflow — modes restants et incidents.",
        domaine: "developpement",
        mode: "distance",
        currency: "XOF",
        delaiJours: 20,
        professionalType: "EXPERT_DIGITAL",
        level: "Senior",
        status: "publiee",
        ...body,
      })
    ),
    "publication"
  );
  const { id } = (await res.json()) as { id: string };
  missionIds.push(id);
  return prisma.mission.findUniqueOrThrow({ where: { id } });
}

async function applyAndAccept(missionId: string, proposal: Record<string, unknown>) {
  authAs(ids.provider);
  const p = await expectOk(await proposalPost(postReq(proposal), at(missionId)), "candidature");
  const proposalId = (await p.json()).id as string;
  authAs(ids.client);
  await expectOk(await acceptPost(postReq({}), { params: Promise.resolve({ id: missionId, proposalId }) }), "acceptation");
}

async function contractAndSignatures(missionId: string, body: Record<string, unknown> = {}) {
  authAs(ids.client);
  const c = await expectOk(await contractPost(postReq(body), at(missionId)), "génération du contrat");
  const contractId = (await c.json()).id as string;
  contractIds.push(contractId);
  authAs(ids.provider);
  await expectOk(await signPost(postReq({ contractId, certificateId: ids.providerCert, passphrase: PASSPHRASE })), "signature prestataire");
  authAs(ids.client);
  await expectOk(await signPost(postReq({ contractId, certificateId: ids.clientCert, passphrase: PASSPHRASE })), "signature client");
  return contractId;
}

async function fundWholeContract(missionId: string, contractId: string) {
  if ((await prisma.pspEscrowOperation.count({ where: { contractId, instructionType: "hold" } })) === 0) {
    authAs(ids.client);
    await expectOk(await escrowHoldPost(postReq({}), at(missionId)), "financement");
  }
  expect(await pspConfirmsPending(contractId, ["hold"])).toEqual(["hold"]);
}

async function fundJalon(missionId: string, contractId: string, jalonId: string) {
  authAs(ids.client);
  await expectOk(await jalonHoldPost(postReq({}), atJalon(missionId, jalonId)), "financement du jalon");
  expect(await pspConfirmsPending(contractId, ["hold"])).toEqual(["hold"]);
}

async function submitProofs(missionId: string, jalonId: string) {
  authAs(ids.provider);
  await expectOk(await jalonDeliverablePost(proofForm(), atJalon(missionId, jalonId)), "preuve");
  await expectOk(await jalonSubmitPost(postReq({}), atJalon(missionId, jalonId)), "soumission");
}

/** Le client apprécie chaque preuve par la vraie route (plus fidèle qu'une écriture en base). */
async function clientApprovesProofs(missionId: string, jalonId: string) {
  authAs(ids.client);
  const proofs = await prisma.missionAttachment.findMany({ where: { missionId, jalonId, appreciation: null }, select: { id: true } });
  for (const a of proofs) {
    await expectOk(
      await appreciatePost(postReq({ action: "validee" }), { params: Promise.resolve({ id: missionId, jalonId, attachmentId: a.id }) }),
      "appréciation de la preuve"
    );
  }
}

async function deliverAndValidate(missionId: string, jalonId: string) {
  await submitProofs(missionId, jalonId);
  await clientApprovesProofs(missionId, jalonId);
  await expectOk(await jalonObservePost(postReq({ progress: 100 }), atJalon(missionId, jalonId)), "constat");
  await expectOk(await jalonValidatePost(postReq({}), atJalon(missionId, jalonId)), "validation");
}

async function declare(missionId: string, periodStart: string, periodEnd: string, declaredQuantity: number) {
  authAs(ids.provider);
  const res = await expectOk(await attendancePost(postReq({ periodStart, periodEnd, declaredQuantity }), at(missionId)), "déclaration", [201]);
  return (await res.json()).id as string;
}

async function snapshotRow(parcours: string, contractId: string, missionId: string) {
  const b = await escrowBalance(contractId);
  const m = await prisma.mission.findUniqueOrThrow({ where: { id: missionId }, select: { status: true } });
  report.push({ parcours, financé: b.funded, versé: b.released, remboursé: b.refunded, détenu: b.held, mission: m.status });
}

// ── Mise en place ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  let n = 0;
  const mk = (key: string, extra: Record<string, unknown>) =>
    prisma.user.create({
      data: {
        email: `inc-${key}-${RUN}@flexwork.test`,
        tel: `+229${RUN}${++n}5`,
        status: "active",
        country: "BJ",
        firstname: "Incidents",
        lastname: key,
        kycStatus: "verifie",
        role: "client",
        ...extra,
      },
    });
  ids.client = (await mk("client", {})).id;
  ids.provider = (await mk("prestataire", { role: "expert_digital" })).id;
  ids.mediator = (await mk("mediation", { isAdmin: true, adminRole: "mediation" })).id;
  ids.supervisor = (await mk("superviseur", { isAdmin: true, adminRole: "superviseur" })).id;

  await prisma.featureFlag.upsert({
    where: { key_zone: { key: "psp_montage_valide", zone: "BJ" } },
    update: { enabled: true },
    create: { key: "psp_montage_valide", zone: "BJ", enabled: true },
  });

  authAs(ids.provider);
  ids.providerCert = (await (await expectOk(await certPost(postReq({ commonName: "Incidents Prestataire", email: `inc-prestataire-${RUN}@flexwork.test`, passphrase: PASSPHRASE })), "certificat", [201])).json()).data.id;
  authAs(ids.client);
  ids.clientCert = (await (await expectOk(await certPost(postReq({ commonName: "Incidents Client", email: `inc-client-${RUN}@flexwork.test`, passphrase: PASSPHRASE })), "certificat", [201])).json()).data.id;
}, LONG);

afterAll(async () => {
  const users = [ids.client, ids.provider, ids.mediator, ids.supervisor].filter(Boolean);
  if (report.length) {
    console.log("\n══ WORKFLOW — MODES RESTANTS ET INCIDENTS — état final ══");
    console.table(report);
  }
  await prisma.pspEventLog.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.adminAuditLog.deleteMany({ where: { adminId: { in: [ids.mediator, ids.supervisor] } } });
  await prisma.contractAuditEntry.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contractSignature.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.progressCheckpoint.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.progressRejection.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.missionNotification.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  if (gig.gigId) {
    await prisma.payable.deleteMany({ where: { sourceType: "gig_order", sourceId: gig.orderId } });
    await prisma.gigOrderAuditEntry.deleteMany({ where: { order: { gigId: gig.gigId } } });
    await prisma.gigOrderSignature.deleteMany({ where: { order: { gigId: gig.gigId } } });
    await prisma.pspEscrowOperation.deleteMany({ where: { order: { gigId: gig.gigId } } });
    await prisma.gigOrder.deleteMany({ where: { gigId: gig.gigId } });
    await prisma.gig.deleteMany({ where: { id: gig.gigId } });
  }
  await prisma.digitalCertificate.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}, LONG);

// ── W1 — J1 prix fixe, refus PSP, reprise ─────────────────────────────────────────────────────

describe("W1 — J1 prix fixe : un versement refusé par le PSP se reprend", () => {
  it("les jalons saisis sont respectés ; refus → créance due → revalidation → versement", async () => {
    const mission = await publish({ titre: `INC J1 ${RUN}`, budgetType: "FIXED", budget: 90_000, financingModeKey: "J1" });
    await applyAndAccept(mission.id, { montant: 90_000 });
    const contractId = await contractAndSignatures(mission.id, {
      jalons: [
        { titre: "Maquettes", montant: 30_000 },
        { titre: "Intégration", montant: 60_000 },
      ],
    });
    const jalons = await prisma.jalon.findMany({ where: { contractId }, orderBy: { ordre: "asc" } });
    // Régression du correctif : en prix fixe, le découpage du client fait foi.
    expect(jalons.map((j) => [j.titre, j.montant])).toEqual([["Maquettes", 30_000], ["Intégration", 60_000]]);

    await fundJalon(mission.id, contractId, jalons[0].id);
    await deliverAndValidate(mission.id, jalons[0].id);

    // Le PSP refuse le versement : la créance reste due, le jalon redevient décidable.
    const refus = await pspRefusesPending(contractId, "release");
    const payable = await prisma.payable.findFirstOrThrow({ where: { sourceId: jalons[0].id } });
    expect(payable.status).toBe("failed");
    expect((await prisma.jalon.findUniqueOrThrow({ where: { id: jalons[0].id } })).status).toBe("livrable_soumis");
    expect(await goldenRules(contractId)).toMatchObject({ released: 0, held: 30_000 });

    // Le client revalide : nouveau versement, sur la MÊME créance.
    authAs(ids.client);
    await expectOk(await jalonValidatePost(postReq({}), atJalon(mission.id, jalons[0].id)), "revalidation");
    const reprise = await prisma.pspEscrowOperation.findFirstOrThrow({ where: { jalonId: jalons[0].id, instructionType: "release", status: "pending" } });
    expect(reprise.id).not.toBe(refus.id);
    expect(await prisma.payable.count({ where: { sourceId: jalons[0].id } })).toBe(1);
    expect(await pspConfirmsPending(contractId)).toEqual(["release"]);
    expect((await prisma.jalon.findUniqueOrThrow({ where: { id: jalons[0].id } })).status).toBe("libere");

    await fundJalon(mission.id, contractId, jalons[1].id);
    await deliverAndValidate(mission.id, jalons[1].id);
    expect(await pspConfirmsPending(contractId)).toEqual(["release"]);

    expect(await goldenRules(contractId)).toMatchObject({ funded: 90_000, released: 90_000, held: 0 });
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("cloturee");
    await snapshotRow("J1 — refus PSP puis reprise", contractId, mission.id);
  }, LONG);
});

// ── W2 — J3 ───────────────────────────────────────────────────────────────────────────────────

describe("W2 — J3 prix fixe : le paiement suit les paliers de progression", () => {
  it("50 % confirmé libère la moitié, 100 % libère le reste et clôture", async () => {
    const mission = await publish({ titre: `INC J3 ${RUN}`, budgetType: "FIXED", budget: 120_000, financingModeKey: "J3" });
    await applyAndAccept(mission.id, { montant: 120_000 });
    const contractId = await contractAndSignatures(mission.id, { jalons: [{ titre: "Développement", montant: 120_000 }] });
    expect((await prisma.prestationContract.findUniqueOrThrow({ where: { id: contractId } })).financingMode).toBe("progressive");
    const [jalon] = await prisma.jalon.findMany({ where: { contractId } });

    await fundJalon(mission.id, contractId, jalon.id);
    await submitProofs(mission.id, jalon.id);
    await clientApprovesProofs(mission.id, jalon.id);

    authAs(ids.client);
    const p50 = await (await expectOk(await jalonCheckpointPost(postReq({ progress: 50 }), atJalon(mission.id, jalon.id)), "palier 50 %")).json();
    expect(p50.releasedAmount).toBe(60_000);
    expect(await pspConfirmsPending(contractId)).toEqual(["release"]);
    expect(await goldenRules(contractId)).toMatchObject({ released: 60_000, held: 60_000 });

    const p100 = await (await expectOk(await jalonCheckpointPost(postReq({ progress: 100 }), atJalon(mission.id, jalon.id)), "palier 100 %")).json();
    expect(p100.releasedAmount).toBe(60_000);
    expect(await pspConfirmsPending(contractId)).toEqual(["release"]);

    expect(await goldenRules(contractId)).toMatchObject({ funded: 120_000, released: 120_000, held: 0 });
    expect((await prisma.jalon.findUniqueOrThrow({ where: { id: jalon.id } })).status).toBe("libere");
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("cloturee");
    await snapshotRow("J3 — paliers", contractId, mission.id);
  }, LONG);
});

// ── W3 — J1 sur devis ─────────────────────────────────────────────────────────────────────────

describe("W3 — J1 sur vrai devis : les lignes deviennent les jalons", () => {
  it("devis à deux lignes → validation → contrat dérivé sans ressaisie → clôture", async () => {
    const mission = await publish({ titre: `INC Devis ${RUN}`, budgetType: "QUOTE", financingModeKey: "J1" });
    authAs(ids.provider);
    const devis = await (
      await expectOk(
        await devisPost(
          postReq({
            lineItems: [
              { description: "Fournitures et matériel", quantity: 1, unit: "forfait", unitPrice: 100_000 },
              { description: "Pose et finitions", quantity: 1, unit: "forfait", unitPrice: 50_000 },
            ],
            delay: "10 jours",
            tvaRate: 0,
            laborCost: 0,
          }),
          at(mission.id)
        ),
        "devis"
      )
    ).json();
    authAs(ids.client);
    await expectOk(await devisValidatePost(postReq({}), { params: Promise.resolve({ id: mission.id, proposalId: devis.proposalId }) }), "validation du devis");

    // Corps VIDE : le mode choisi à la publication dérive les jalons du devis.
    const contractId = await contractAndSignatures(mission.id, {});
    const jalons = await prisma.jalon.findMany({ where: { contractId }, orderBy: { ordre: "asc" } });
    expect(jalons.map((j) => [j.titre, j.montant])).toEqual([["Fournitures et matériel", 100_000], ["Pose et finitions", 50_000]]);

    for (const jalon of jalons) {
      await fundJalon(mission.id, contractId, jalon.id);
      await deliverAndValidate(mission.id, jalon.id);
      expect(await pspConfirmsPending(contractId)).toEqual(["release"]);
      await goldenRules(contractId);
    }
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("cloturee");
    await snapshotRow("J1 — sur devis", contractId, mission.id);
  }, LONG);
});

// ── W4 — S2H : tous les incidents d'un chantier au temps ──────────────────────────────────────

describe("W4 — S2H : refus PSP, gel, insuffisance, recharge et reprise automatique", () => {
  it("le prestataire est payé de chaque heure constatée, quel que soit l'incident", async () => {
    const mission = await publish({ titre: `INC S2H ${RUN}`, budgetType: "RATE", financingModeKey: "S2H", timeRate: 1_500, timeMaxQuantity: 20 });
    await applyAndAccept(mission.id, { montant: 0, unitRate: 1_500 });
    const contractId = await contractAndSignatures(mission.id);
    expect(await prisma.spotTimeTerms.findUniqueOrThrow({ where: { contractId } })).toMatchObject({ rateUnit: "hour", rate: 1_500, maxAmount: 30_000 });
    await fundWholeContract(mission.id, contractId);

    // A — 12 heures constatées, versement REFUSÉ par le PSP.
    const a = await declare(mission.id, "2026-09-01T00:00:00.000Z", "2026-09-01T23:59:59.999Z", 12);
    authAs(ids.client);
    await expectOk(await attendanceDecisionPost(postReq({ approvedQuantity: 12 }), atAttendance(mission.id, a)), "constat A");
    await pspRefusesPending(contractId, "release");
    const creanceA = await prisma.payable.findFirstOrThrow({ where: { sourceId: a } });
    expect(creanceA.status).toBe("failed");

    // Réinstruction : refusée au Superviseur, exige une justification, puis part.
    authAs(ids.supervisor);
    expect((await reinstructPost(postReq({ justification: "Tentative superviseur" }), { params: Promise.resolve({ payableId: creanceA.id }) })).status).toBe(403);
    authAs(ids.mediator);
    expect((await reinstructPost(postReq({}), { params: Promise.resolve({ payableId: creanceA.id }) })).status).toBe(400);
    const reinstruite = await (
      await expectOk(
        await reinstructPost(postReq({ justification: "Refus PSP transitoire, solde vérifié" }), { params: Promise.resolve({ payableId: creanceA.id }) }),
        "réinstruction"
      )
    ).json();
    expect(reinstruite.amount).toBe(18_000);
    expect(await pspConfirmsPending(contractId)).toEqual(["release"]);
    expect((await prisma.payable.findUniqueOrThrow({ where: { id: creanceA.id } })).status).toBe("paid");
    expect(await prisma.adminAuditLog.count({ where: { adminId: ids.mediator, action: "escrow_payable_reinstruct" } })).toBe(1);
    // Une seconde réinstruction ne ferait rien : la créance n'est plus due.
    expect((await reinstructPost(postReq({ justification: "Doublon" }), { params: Promise.resolve({ payableId: creanceA.id }) })).status).toBe(409);
    expect(await goldenRules(contractId)).toMatchObject({ released: 18_000, available: 12_000 });

    // B — 8 heures déclarées, toutes contestées : 12 000 gelés, plus rien de disponible.
    const b = await declare(mission.id, "2026-09-02T00:00:00.000Z", "2026-09-02T23:59:59.999Z", 8);
    authAs(ids.client);
    await expectOk(await attendanceDecisionPost(postReq({ action: "dispute", approvedQuantity: 0, reason: "Présence non constatée" }), atAttendance(mission.id, b)), "contestation B");
    expect(await pspConfirmsPending(contractId)).toEqual(["freeze"]);
    expect(await goldenRules(contractId)).toMatchObject({ blocked: 12_000, available: 0 });

    // C — 8 heures constatées alors que le séquestre ne couvre plus rien : la créance reste due.
    const c = await declare(mission.id, "2026-09-03T00:00:00.000Z", "2026-09-03T23:59:59.999Z", 8);
    authAs(ids.client);
    const insuffisant = await attendanceDecisionPost(postReq({ approvedQuantity: 8 }), atAttendance(mission.id, c));
    expect(insuffisant.status).toBe(409);
    expect((await insuffisant.json()).error).toBe("escrow_insufficient");
    expect((await prisma.payable.findFirstOrThrow({ where: { sourceId: c } })).status).toBe("validated");

    // Recharge : le client voit le manque exact, complète, et le versement part SANS nouveau geste.
    expect(await (await expectOk(await rechargeGet(getReq(), at(mission.id)), "besoin de recharge")).json()).toMatchObject({ due: 12_000, available: 0, missing: 12_000 });
    await expectOk(await rechargePost(postReq({}), at(mission.id)), "recharge");
    expect(await pspConfirmsPending(contractId, ["hold"])).toEqual(["hold"]);
    expect((await prisma.payable.findFirstOrThrow({ where: { sourceId: c } })).status).toBe("instructed");
    expect(await pspConfirmsPending(contractId)).toEqual(["release"]);
    expect((await prisma.payable.findFirstOrThrow({ where: { sourceId: c } })).status).toBe("paid");
    expect(await goldenRules(contractId)).toMatchObject({ funded: 42_000, released: 30_000, blocked: 12_000 });
    // Les 20 heures du plafond sont payées : le webhook clôt la mission, contestation encore ouverte.
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("cloturee");

    // Arbitrage : les heures contestées sont écartées, le gel est levé.
    await expectOk(await attendanceDecisionPost(postReq({ action: "resolve", accept: false }), atAttendance(mission.id, b)), "arbitrage B");
    expect(await pspConfirmsPending(contractId)).toEqual(["unfreeze"]);

    // Le chantier est déjà clos : la clôture sert à récupérer tout de suite les 12 000 libérés par
    // l'arbitrage, sans attendre le balayage du lendemain.
    const cloture = await (await expectOk(await timeClosePost(postReq({}), at(mission.id)), "récupération du solde")).json();
    expect(cloture).toEqual({ ok: true, refunded: 12_000 });
    expect(await pspConfirmsPending(contractId)).toEqual(["refund"]);
    expect(await goldenRules(contractId)).toMatchObject({ funded: 42_000, released: 30_000, refunded: 12_000, held: 0 });
    // Plus rien à rendre : une nouvelle demande le dit.
    expect((await timeClosePost(postReq({}), at(mission.id))).status).toBe(409);
    await snapshotRow("S2H — incidents", contractId, mission.id);
  }, LONG);
});

// ── W5 — S2M ──────────────────────────────────────────────────────────────────────────────────

describe("W5 — S2M : un mois constaté, puis clôture", () => {
  it("720 000 séquestrés pour 3 mois, un mois versé, le reste rendu", async () => {
    const mission = await publish({ titre: `INC S2M ${RUN}`, budgetType: "RATE", financingModeKey: "S2M", timeRate: 250_000, timeMaxQuantity: 3 });
    expect(mission.budget).toBe(750_000);
    await applyAndAccept(mission.id, { montant: 0, unitRate: 240_000 });
    const contractId = await contractAndSignatures(mission.id);
    expect(await prisma.spotTimeTerms.findUniqueOrThrow({ where: { contractId } })).toMatchObject({ rateUnit: "month", maxAmount: 720_000 });
    await fundWholeContract(mission.id, contractId);

    const septembre = await declare(mission.id, "2026-09-01T00:00:00.000Z", "2026-09-30T23:59:59.999Z", 1);
    authAs(ids.client);
    await expectOk(await attendanceDecisionPost(postReq({ approvedQuantity: 1 }), atAttendance(mission.id, septembre)), "constat septembre");
    expect(await pspConfirmsPending(contractId)).toEqual(["release"]);

    // Le même mois ne se déclare pas deux fois.
    authAs(ids.provider);
    expect((await attendancePost(postReq({ periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-09-30T23:59:59.999Z", declaredQuantity: 1 }), at(mission.id))).status).toBe(409);

    authAs(ids.client);
    expect(await (await expectOk(await timeClosePost(postReq({}), at(mission.id)), "clôture")).json()).toEqual({ ok: true, refunded: 480_000 });
    expect(await pspConfirmsPending(contractId)).toEqual(["refund"]);
    expect(await goldenRules(contractId)).toMatchObject({ funded: 720_000, released: 240_000, refunded: 480_000, held: 0 });
    await snapshotRow("S2M — mensuel", contractId, mission.id);
  }, LONG);
});

// ── W6 — Acceptation tacite ───────────────────────────────────────────────────────────────────

describe("W6 — acceptation tacite : le silence du client, passé le délai, paie le prestataire", () => {
  it("livrable soumis, 8 jours sans réponse → versement → clôture", async () => {
    const mission = await publish({ titre: `INC Tacite ${RUN}`, budgetType: "FIXED", budget: 80_000, financingModeKey: "J1" });
    await applyAndAccept(mission.id, { montant: 80_000 });
    const contractId = await contractAndSignatures(mission.id, { jalons: [{ titre: "Livraison", montant: 80_000 }] });
    const [jalon] = await prisma.jalon.findMany({ where: { contractId } });
    await fundJalon(mission.id, contractId, jalon.id);
    await submitProofs(mission.id, jalon.id);

    // Dans le délai, rien ne part.
    await runTacitAcceptanceSweep();
    expect(await prisma.pspEscrowOperation.count({ where: { jalonId: jalon.id, instructionType: "release" } })).toBe(0);

    // Le délai contractuel (7 jours) est dépassé.
    await prisma.jalon.update({ where: { id: jalon.id }, data: { submittedAt: new Date(Date.now() - 8 * DAY) } });
    const sweep = await runTacitAcceptanceSweep();
    expect(sweep.applied).toBeGreaterThanOrEqual(1);
    expect(await pspConfirmsPending(contractId)).toEqual(["release"]);

    expect(await goldenRules(contractId)).toMatchObject({ released: 80_000, held: 0 });
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("cloturee");
    await snapshotRow("J1 — acceptation tacite", contractId, mission.id);
  }, LONG);
});

// ── W7 — Mission arrêtée ──────────────────────────────────────────────────────────────────────

describe("W7 — mission arrêtée : les gestes administratifs soldent le séquestre", () => {
  it("J4 interrompu après un jalon : la retenue acquise est soldée au prestataire", async () => {
    const mission = await publish({ titre: `INC J4 arrêt ${RUN}`, budgetType: "FIXED", budget: 200_000, financingModeKey: "J4" });
    await applyAndAccept(mission.id, { montant: 200_000 });
    const contractId = await contractAndSignatures(mission.id, {
      jalons: [
        { titre: "Phase 1", montant: 100_000 },
        { titre: "Phase 2", montant: 100_000 },
      ],
    });
    const [phase1] = await prisma.jalon.findMany({ where: { contractId }, orderBy: { ordre: "asc" } });
    await fundJalon(mission.id, contractId, phase1.id);
    await deliverAndValidate(mission.id, phase1.id);
    expect(await pspConfirmsPending(contractId)).toEqual(["release"]);
    expect(await goldenRules(contractId)).toMatchObject({ released: 95_000, retained: 5_000 });

    authAs(ids.mediator);
    expect((await retentionSettlePost(postReq({}), { params: Promise.resolve({ contractId }) })).status).toBe(400);
    const solde = await (await expectOk(await retentionSettlePost(postReq({ justification: "Mission arrêtée d'un commun accord" }), { params: Promise.resolve({ contractId }) }), "solde de retenue")).json();
    expect(solde.amount).toBe(5_000);
    expect(await pspConfirmsPending(contractId)).toEqual(["retention_release"]);
    expect(await goldenRules(contractId)).toMatchObject({ funded: 100_000, released: 100_000, retained: 0, held: 0 });
    expect(await prisma.adminAuditLog.count({ where: { adminId: ids.mediator, action: "escrow_retention_settle", targetId: contractId } })).toBe(1);
    await snapshotRow("J4 — arrêtée, retenue soldée", contractId, mission.id);
  }, LONG);

  it("F2 abandonné avant livraison : le séquestre est rendu au client", async () => {
    const mission = await publish({ titre: `INC F2 abandon ${RUN}`, budgetType: "FIXED", budget: 70_000, financingModeKey: "F2" });
    await applyAndAccept(mission.id, { montant: 70_000 });
    const contractId = await contractAndSignatures(mission.id);
    await fundWholeContract(mission.id, contractId);

    authAs(ids.mediator);
    const remboursement = await (await expectOk(await adminRefundPost(postReq({ justification: "Prestataire injoignable depuis 30 jours" }), { params: Promise.resolve({ contractId }) }), "remboursement")).json();
    expect(remboursement.amount).toBe(70_000);
    expect(await pspConfirmsPending(contractId)).toEqual(["refund"]);
    expect(await goldenRules(contractId)).toMatchObject({ funded: 70_000, refunded: 70_000, held: 0 });
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("remboursee");
    await snapshotRow("F2 — abandonné, remboursé", contractId, mission.id);
  }, LONG);
});

// ── W8 — Commande Gig ─────────────────────────────────────────────────────────────────────────

describe("W8 — commande Gig : achat direct d'une prestation", () => {
  it("publication, achat, signatures, séquestre, validation, versement", async () => {
    authAs(ids.provider);
    const created = await (
      await expectOk(
        await gigPost(postReq({ titre: `Audit SEO ${RUN}`, description: "Audit SEO complet et recommandations.", domaine: "expert_digital", prix: 60_000, delaiJours: 7, status: "publie" })),
        "publication du Gig",
        [201]
      )
    ).json();
    gig.gigId = created.id;

    authAs(ids.client);
    gig.orderId = (await (await expectOk(await gigPurchasePost(postReq({}), at(gig.gigId)), "achat", [201])).json()).orderId;

    await expectOk(await gigSignPost(postReq({ certificateId: ids.clientCert, passphrase: PASSPHRASE }), { params: Promise.resolve({ orderId: gig.orderId }) }), "signature client");
    expect(await gigHeldBalance(gig.orderId)).toBe(60_000);
    authAs(ids.provider);
    await expectOk(await gigSignPost(postReq({ certificateId: ids.providerCert, passphrase: PASSPHRASE }), { params: Promise.resolve({ orderId: gig.orderId }) }), "signature prestataire");
    expect((await prisma.gigOrder.findUniqueOrThrow({ where: { id: gig.orderId } })).status).toBe("active");

    authAs(ids.client);
    expect(await (await expectOk(await gigValidatePost(postReq({}), { params: Promise.resolve({ orderId: gig.orderId }) }), "validation de la livraison")).json()).toMatchObject({ amount: 60_000, status: "completed" });
    expect((await prisma.gigOrder.findUniqueOrThrow({ where: { id: gig.orderId } })).status).toBe("completed");
    expect(await gigHeldBalance(gig.orderId)).toBe(0);
    report.push({ parcours: "Gig — achat direct", financé: 60_000, versé: 60_000, remboursé: 0, détenu: 0, mission: "completed" });
  }, LONG);
});

// ── W9 — Console et journal ───────────────────────────────────────────────────────────────────

describe("W9 — console admin et journal PSP sur l'ensemble des parcours", () => {
  it("aucune règle d'or violée, aucun reliquat oublié, chaque message PSP tracé", async () => {
    authAs(ids.supervisor);
    const snap = await (await expectOk(await financeGet(), "console")).json();
    const rows = (snap.rows as ContractFinanceRow[]).filter((r) => contractIds.includes(r.contractId));
    expect(rows).toHaveLength(contractIds.length);
    for (const r of rows) expect(r.violations).toEqual([]);

    const anomalies = (snap.anomalies as Anomaly[]).filter((a) => a.contractId && contractIds.includes(a.contractId));
    expect(anomalies).toEqual([]);

    // Chaque dénouement (confirmation OU refus) a laissé exactement une trace appliquée, aucune rejetée.
    const denouements = await prisma.pspEscrowOperation.count({
      where: { contractId: { in: contractIds }, status: { in: ["confirmed", "failed"] }, pspReference: { not: null } },
    });
    expect(await prisma.pspEventLog.count({ where: { contractId: { in: contractIds }, outcome: "applied" } })).toBe(denouements);
    expect(await prisma.pspEventLog.count({ where: { contractId: { in: contractIds }, outcome: "rejected" } })).toBe(0);
    expect(await prisma.pspEventLog.count({ where: { contractId: { in: contractIds }, event: "failed" } })).toBe(2);
  }, LONG);
});
