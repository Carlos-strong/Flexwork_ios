/**
 * WORKFLOW COMPLET — tous les parcours financiers de la plateforme, de la publication à la clôture
 * (2026-09-15).
 *
 * Les autres tests e2e verrouillent chacun un maillon. Celui-ci enchaîne les maillons tels qu'un
 * vrai client et un vrai prestataire les traversent, par les VRAIES routes (auth simulée, base
 * réelle, signature électronique RSA réelle, confirmations PSP par webhook signé) :
 *
 *   P1  F2  — prix fixe, séquestre unique, livrable unique, versement, clôture
 *   P2  J4  — jalons financés un à un, retenue de garantie 5 %, solde de retenue, clôture
 *   P3  S1  — forfait à sous-tâches, UN seul financement consommé tâche par tâche
 *   P4  S2J — publication au temps, candidature au tarif, responsable de chantier, pointage,
 *             contestation, arbitrage, clôture du chantier et remboursement du reliquat
 *   P5  Médiation — gel, proposition admin (libérer / rembourser / maintenir bloqué), accord
 *   P6  Console admin & journal PSP — les chiffres, les anomalies et chaque échange tracé
 *
 * Après CHAQUE mouvement de fonds : les deux règles d'or et l'identité comptable
 * (financé = versé + remboursé + détenu).
 *
 * Mode CONSOLE de la PSP virtuelle : aucune confirmation automatique, chaque instruction est
 * dénouée explicitement — c'est la temporalité de la production.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as missionPost } from "@/app/api/missions/route";
import { POST as proposalPost } from "@/app/api/missions/[id]/proposals/route";
import { POST as acceptPost } from "@/app/api/missions/[id]/proposals/[proposalId]/accept/route";
import { POST as contractPost } from "@/app/api/missions/[id]/contract/route";
import { POST as certPost } from "@/app/api/signature/certificate/route";
import { POST as signPost } from "@/app/api/signature/sign/route";
import { POST as escrowHoldPost } from "@/app/api/missions/[id]/escrow/hold/route";
import { POST as escrowReleasePost } from "@/app/api/missions/[id]/escrow/release/route";
import { GET as balanceGet } from "@/app/api/missions/[id]/escrow/balance/route";
import { POST as missionDeliverablePost } from "@/app/api/missions/[id]/deliverable/route";
import { POST as missionSubmitPost } from "@/app/api/missions/[id]/deliverable/submit/route";
import { POST as missionObservePost } from "@/app/api/missions/[id]/observe-progress/route";
import { POST as jalonHoldPost } from "@/app/api/missions/[id]/jalons/[jalonId]/hold/route";
import { POST as jalonDeliverablePost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/route";
import { POST as jalonSubmitPost } from "@/app/api/missions/[id]/jalons/[jalonId]/submit/route";
import { POST as jalonObservePost } from "@/app/api/missions/[id]/jalons/[jalonId]/observe-progress/route";
import { POST as jalonValidatePost } from "@/app/api/missions/[id]/jalons/[jalonId]/validate/route";
import { PATCH as siteManagerPatch } from "@/app/api/missions/[id]/site-manager/route";
import { POST as attendancePost } from "@/app/api/missions/[id]/attendance/route";
import { POST as attendanceDecisionPost } from "@/app/api/missions/[id]/attendance/[attendanceId]/route";
import { POST as timeClosePost } from "@/app/api/missions/[id]/time-contract/close/route";
import { POST as mediationPost } from "@/app/api/missions/[id]/mediation/route";
import { POST as proposeResolutionPost } from "@/app/api/admin/mediations/[id]/propose/route";
import { POST as respondResolutionPost } from "@/app/api/admin/mediations/[id]/respond/route";
import { GET as financeGet } from "@/app/api/admin/finance/route";
import { GET as journalGet } from "@/app/api/admin/finance/psp-journal/route";
import { GET as clientPaymentsGet } from "@/app/api/dashboard/client-payments/route";
import { GET as providerSummaryGet } from "@/app/api/dashboard/provider-summary/route";
import { prisma } from "@/lib/db";
import { escrowBalance, type EscrowBalance } from "@/lib/escrow";
import { checkEscrowInvariants } from "@/lib/escrow-invariants";
import { operateVirtualPsp, type VirtualPspAction } from "@/lib/psp-virtual";
import type { Anomaly, ContractFinanceRow } from "@/lib/admin-finance";
import type { JournalItem } from "@/lib/psp-journal";

const RUN = Date.now();
const PASSPHRASE = "passphrase-workflow-2026";
const LONG = 120_000;

const ids = {
  client: "",
  provider: "",
  siteManager: "",
  mediator: "",
  supervisor: "",
  clientCert: "",
  providerCert: "",
};
const missionIds: string[] = [];
const contracts: Record<"F2" | "J4" | "S1" | "S2J" | "MED", { missionId: string; contractId: string }> = {
  F2: { missionId: "", contractId: "" },
  J4: { missionId: "", contractId: "" },
  S1: { missionId: "", contractId: "" },
  S2J: { missionId: "", contractId: "" },
  MED: { missionId: "", contractId: "" },
};

// ── Outils ────────────────────────────────────────────────────────────────────────────────────

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function patchReq(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const getReq = (url = "http://localhost/api") => new Request(url);
const at = (id: string) => ({ params: Promise.resolve({ id }) });
const atJalon = (id: string, jalonId: string) => ({ params: Promise.resolve({ id, jalonId }) });

function proofForm(): Request {
  const fd = new FormData();
  fd.append("category", "other");
  fd.append("note", "Preuve de réalisation — workflow complet");
  return new Request("http://localhost/api", { method: "POST", body: fd });
}

async function expectOk(res: Response, label: string, codes = [200, 201]) {
  if (!codes.includes(res.status)) {
    const body = await res.clone().text();
    throw new Error(`${label} → HTTP ${res.status} : ${body}`);
  }
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

/** Le PSP dénoue toutes les instructions en attente du contrat (ou celles d'un type). */
async function pspConfirmsPending(contractId: string, types?: string[]): Promise<string[]> {
  const ops = await prisma.pspEscrowOperation.findMany({
    where: { contractId, status: "pending", ...(types ? { instructionType: { in: types as never } } : {}) },
    orderBy: [{ instructionSentAt: "asc" }, { id: "asc" }],
  });
  for (const op of ops) {
    const result = await operateVirtualPsp(ACTION[op.instructionType], op.pspReference!);
    expect(result, `${op.instructionType} ${op.amount}`).toMatchObject({ ok: true });
  }
  return ops.map((o) => o.instructionType);
}

/** Règles d'or et identité comptable — appelé après chaque mouvement. */
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
        description: "Mission du test de workflow complet, de la publication à la clôture.",
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
  // Relue en base : la route ne renvoie pas tous les champs, et c'est l'état persisté qui compte.
  return prisma.mission.findUniqueOrThrow({ where: { id } });
}

async function applyAndAccept(missionId: string, proposal: Record<string, unknown>) {
  authAs(ids.provider);
  const p = await expectOk(await proposalPost(postReq(proposal), at(missionId)), "candidature");
  const proposalId = (await p.json()).id as string;
  authAs(ids.client);
  await expectOk(await acceptPost(postReq({}), { params: Promise.resolve({ id: missionId, proposalId }) }), "acceptation");
  return proposalId;
}

async function contractAndSignatures(missionId: string, body: Record<string, unknown> = {}) {
  authAs(ids.client);
  const c = await expectOk(await contractPost(postReq(body), at(missionId)), "génération du contrat");
  const contractId = (await c.json()).id as string;

  authAs(ids.provider);
  await expectOk(await signPost(postReq({ contractId, certificateId: ids.providerCert, passphrase: PASSPHRASE })), "signature prestataire");
  authAs(ids.client);
  await expectOk(await signPost(postReq({ contractId, certificateId: ids.clientCert, passphrase: PASSPHRASE })), "signature client");

  expect((await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })).status).toBe("contrat_signe");
  return contractId;
}

/** Financement unique du contrat : HOLD (déclenché à la signature ou par le client), puis PSP. */
async function fundWholeContract(missionId: string, contractId: string) {
  const deja = await prisma.pspEscrowOperation.count({ where: { contractId, instructionType: "hold" } });
  if (deja === 0) {
    authAs(ids.client);
    await expectOk(await escrowHoldPost(postReq({}), at(missionId)), "financement");
  }
  expect(await pspConfirmsPending(contractId, ["hold"])).toEqual(["hold"]);
  expect((await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })).status).toBe("fonds_sous_sequestre");
}

async function clientValidatesProofs(where: { missionId: string; jalonId: string | null }) {
  await prisma.missionAttachment.updateMany({
    where: { ...where, appreciation: null },
    data: { appreciation: "validee", appreciatedById: ids.client, appreciatedAt: new Date() },
  });
}

/** Livraison d'un jalon : preuve, soumission, constat 100 %, validation. */
async function deliverJalon(missionId: string, jalonId: string) {
  authAs(ids.provider);
  await expectOk(await jalonDeliverablePost(proofForm(), atJalon(missionId, jalonId)), "preuve du jalon");
  await expectOk(await jalonSubmitPost(postReq({}), atJalon(missionId, jalonId)), "soumission du jalon");
  authAs(ids.client);
  await clientValidatesProofs({ missionId, jalonId });
  await expectOk(await jalonObservePost(postReq({ progress: 100 }), atJalon(missionId, jalonId)), "constat du jalon");
  await expectOk(await jalonValidatePost(postReq({}), atJalon(missionId, jalonId)), "validation du jalon");
}

const report: Record<string, unknown>[] = [];

async function snapshotRow(parcours: string, contractId: string, missionId: string) {
  const b = await escrowBalance(contractId);
  const m = await prisma.mission.findUniqueOrThrow({ where: { id: missionId }, select: { status: true } });
  report.push({
    parcours,
    financé: b.funded,
    versé: b.released,
    remboursé: b.refunded,
    détenu: b.held,
    gelé: b.blocked,
    retenu: b.retained,
    mission: m.status,
  });
}

// ── Mise en place ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const mk = (key: string, extra: Record<string, unknown>) =>
    prisma.user.create({
      data: {
        email: `wf-${key}-${RUN}@flexwork.test`,
        tel: `+229${RUN}${key.length}${Object.keys(extra).length}`,
        status: "active",
        country: "BJ",
        firstname: "Workflow",
        lastname: key,
        kycStatus: "verifie",
        role: "client",
        ...extra,
      },
    });
  ids.client = (await mk("client", {})).id;
  ids.provider = (await mk("prestataire", { role: "expert_digital" })).id;
  ids.siteManager = (await mk("chantier", { role: "responsable_chantier" })).id;
  ids.mediator = (await mk("mediation", { isAdmin: true, adminRole: "mediation" })).id;
  ids.supervisor = (await mk("superviseur", { isAdmin: true, adminRole: "superviseur" })).id;

  await prisma.featureFlag.upsert({
    where: { key_zone: { key: "psp_montage_valide", zone: "BJ" } },
    update: { enabled: true },
    create: { key: "psp_montage_valide", zone: "BJ", enabled: true },
  });

  authAs(ids.provider);
  const certP = await expectOk(
    await certPost(postReq({ commonName: "Workflow Prestataire", email: `wf-prestataire-${RUN}@flexwork.test`, passphrase: PASSPHRASE })),
    "certificat prestataire",
    [201]
  );
  ids.providerCert = (await certP.json()).data.id;
  authAs(ids.client);
  const certC = await expectOk(
    await certPost(postReq({ commonName: "Workflow Client", email: `wf-client-${RUN}@flexwork.test`, passphrase: PASSPHRASE })),
    "certificat client",
    [201]
  );
  ids.clientCert = (await certC.json()).data.id;
}, LONG);

afterAll(async () => {
  const contractIds = Object.values(contracts).map((c) => c.contractId).filter(Boolean);
  const users = Object.entries(ids).filter(([k]) => !k.endsWith("Cert")).map(([, v]) => v).filter(Boolean);

  if (report.length) {
    console.log("\n══ WORKFLOW COMPLET — état final du séquestre par parcours ══");
    console.table(report);
  }

  await prisma.pspEventLog.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.adminAuditLog.deleteMany({ where: { adminId: { in: [ids.mediator, ids.supervisor] } } });
  await prisma.contractAuditEntry.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contractSignature.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.missionNotification.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  // La suppression des missions emporte, en cascade, contrats, jalons, opérations, créances,
  // relevés, médiations, pièces jointes et candidatures.
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.digitalCertificate.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}, LONG);

// ── P1 — F2 ───────────────────────────────────────────────────────────────────────────────────

describe("P1 — F2 : prix fixe, séquestre unique, versement unique", () => {
  it("publication → candidature → contrat → signatures → financement → livraison → versement → clôture", async () => {
    const mission = await publish({ titre: `WF F2 ${RUN}`, budgetType: "FIXED", budget: 120_000, financingModeKey: "F2" });
    contracts.F2.missionId = mission.id;
    await applyAndAccept(mission.id, { montant: 120_000, message: "Prix fixe — livraison unique" });
    const contractId = await contractAndSignatures(mission.id);
    contracts.F2.contractId = contractId;
    expect(await prisma.jalon.count({ where: { contractId } })).toBe(0);

    await fundWholeContract(mission.id, contractId);
    expect(await goldenRules(contractId)).toMatchObject({ funded: 120_000, held: 120_000, available: 120_000 });

    authAs(ids.provider);
    await expectOk(await missionDeliverablePost(proofForm(), at(mission.id)), "preuve");
    await expectOk(await missionSubmitPost(postReq({}), at(mission.id)), "soumission");
    authAs(ids.client);
    await clientValidatesProofs({ missionId: mission.id, jalonId: null });
    await expectOk(await missionObservePost(postReq({ progress: 100 }), at(mission.id)), "constat");
    await expectOk(await escrowReleasePost(postReq({}), at(mission.id)), "validation");

    expect(await pspConfirmsPending(contractId)).toEqual(["release"]);
    expect(await goldenRules(contractId)).toMatchObject({ funded: 120_000, released: 120_000, held: 0 });
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("cloturee");
    await snapshotRow("F2 — prix fixe", contractId, mission.id);
  }, LONG);
});

// ── P2 — J4 ───────────────────────────────────────────────────────────────────────────────────

describe("P2 — J4 : jalons + retenue de garantie", () => {
  it("chaque jalon libère 95 %, la retenue cumulée part en une fois à la fin", async () => {
    const mission = await publish({ titre: `WF J4 ${RUN}`, budgetType: "FIXED", budget: 200_000, financingModeKey: "J4" });
    contracts.J4.missionId = mission.id;
    await applyAndAccept(mission.id, { montant: 200_000 });
    const contractId = await contractAndSignatures(mission.id, {
      jalons: [
        { titre: "Gros œuvre", montant: 120_000 },
        { titre: "Finitions", montant: 80_000 },
      ],
    });
    contracts.J4.contractId = contractId;

    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { id: contractId },
      include: { jalons: { orderBy: { ordre: "asc" } } },
    });
    expect(contract.retentionRate).toBe(0.05);
    expect(contract.fundingGranularity).toBe("per_jalon");

    for (const jalon of contract.jalons) {
      authAs(ids.client);
      await expectOk(await jalonHoldPost(postReq({}), atJalon(mission.id, jalon.id)), `financement ${jalon.titre}`);
      expect(await pspConfirmsPending(contractId, ["hold"])).toEqual(["hold"]);
      await goldenRules(contractId);

      await deliverJalon(mission.id, jalon.id);
      const confirmed = await pspConfirmsPending(contractId);
      await goldenRules(contractId);

      const verse = await prisma.pspEscrowOperation.findFirstOrThrow({
        where: { jalonId: jalon.id, instructionType: "release", status: "confirmed" },
      });
      expect(verse.amount).toBe(jalon.montant * 0.95);
      // Le versement du dernier jalon déclenche le solde de la retenue : il est dénoué au tour suivant.
      if (confirmed.includes("release") && jalon.ordre === contract.jalons.length) {
        expect(await pspConfirmsPending(contractId, ["retention_release"])).toEqual(["retention_release"]);
      }
    }

    const b = await goldenRules(contractId);
    expect(b).toMatchObject({ funded: 200_000, released: 200_000, retained: 0, held: 0 });
    const retenue = await prisma.pspEscrowOperation.findFirstOrThrow({ where: { contractId, instructionType: "retention_release" } });
    expect(retenue).toMatchObject({ amount: 10_000, status: "confirmed" });
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("cloturee");
    await snapshotRow("J4 — retenue", contractId, mission.id);
  }, LONG);
});

// ── P3 — S1 ───────────────────────────────────────────────────────────────────────────────────

describe("P3 — S1 : forfait à sous-tâches, un seul financement", () => {
  it("150 000 séquestrés une fois, consommés tâche par tâche : 130 000 → 70 000 → 20 000 → 0", async () => {
    const mission = await publish({ titre: `WF S1 ${RUN}`, budgetType: "FIXED", budget: 150_000, financingModeKey: "S1" });
    contracts.S1.missionId = mission.id;
    await applyAndAccept(mission.id, { montant: 150_000 });
    const contractId = await contractAndSignatures(mission.id, {
      jalons: [
        { titre: "Diagnostic", montant: 20_000 },
        { titre: "Câblage", montant: 60_000 },
        { titre: "Installation", montant: 50_000 },
        { titre: "Essais", montant: 20_000 },
      ],
    });
    contracts.S1.contractId = contractId;
    expect((await prisma.prestationContract.findUniqueOrThrow({ where: { id: contractId } })).fundingGranularity).toBe("upfront");

    await fundWholeContract(mission.id, contractId);
    expect(await prisma.jalon.count({ where: { contractId, status: "fonds_sous_sequestre" } })).toBe(4);

    const jalons = await prisma.jalon.findMany({ where: { contractId }, orderBy: { ordre: "asc" } });
    const soldes: number[] = [];
    for (const jalon of jalons) {
      await deliverJalon(mission.id, jalon.id);
      expect(await pspConfirmsPending(contractId)).toEqual(["release"]);
      soldes.push((await goldenRules(contractId)).held);
    }
    expect(soldes).toEqual([130_000, 70_000, 20_000, 0]);
    expect(await prisma.pspEscrowOperation.count({ where: { contractId, instructionType: "hold" } })).toBe(1);
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("cloturee");
    await snapshotRow("S1 — sous-tâches", contractId, mission.id);
  }, LONG);
});

// ── P4 — S2J ──────────────────────────────────────────────────────────────────────────────────

describe("P4 — S2J : chantier au temps, de la publication à la clôture", () => {
  it("tarif, plafond, responsable de chantier, pointage, contestation, arbitrage, clôture, reliquat", async () => {
    // Publication : le client annonce 7 500 / jour × 20 jours → budget publié = plafond.
    const mission = await publish({
      titre: `WF S2J ${RUN}`,
      budgetType: "RATE",
      financingModeKey: "S2J",
      timeRate: 7_500,
      timeMaxQuantity: 20,
    });
    contracts.S2J.missionId = mission.id;
    expect(mission.budget).toBe(150_000);

    // Candidature : le prestataire propose 7 000 / jour → plafond du contrat 140 000.
    await applyAndAccept(mission.id, { montant: 0, unitRate: 7_000 });
    const contractId = await contractAndSignatures(mission.id);
    contracts.S2J.contractId = contractId;
    expect(await prisma.spotTimeTerms.findUniqueOrThrow({ where: { contractId } })).toMatchObject({
      rateUnit: "day",
      rate: 7_000,
      maxQuantity: 20,
      maxAmount: 140_000,
    });

    await fundWholeContract(mission.id, contractId);
    expect(await goldenRules(contractId)).toMatchObject({ funded: 140_000, available: 140_000 });

    // Le client délègue le constat à un responsable de chantier.
    authAs(ids.client);
    await expectOk(await siteManagerPatch(patchReq({ identifier: `wf-chantier-${RUN}@flexwork.test` }), at(mission.id)), "désignation du responsable");

    // Semaine 1 : 4 jours déclarés, constatés par le responsable de chantier.
    authAs(ids.provider);
    const r1 = await expectOk(
      await attendancePost(
        postReq({ periodStart: "2026-09-01T00:00:00.000Z", periodEnd: "2026-09-04T23:59:59.999Z", declaredQuantity: 4 }),
        at(mission.id)
      ),
      "déclaration semaine 1",
      [201]
    );
    const releve1 = (await r1.json()).id as string;

    // Le prestataire ne peut pas constater ses propres journées.
    const autoValidation = await attendanceDecisionPost(postReq({ approvedQuantity: 4 }), {
      params: Promise.resolve({ id: mission.id, attendanceId: releve1 }),
    });
    expect(autoValidation.status).toBe(404);

    authAs(ids.siteManager);
    await expectOk(
      await attendanceDecisionPost(postReq({ approvedQuantity: 4 }), { params: Promise.resolve({ id: mission.id, attendanceId: releve1 }) }),
      "constat semaine 1"
    );
    expect(await pspConfirmsPending(contractId)).toEqual(["release"]);
    expect(await goldenRules(contractId)).toMatchObject({ released: 28_000, held: 112_000 });

    // Semaine 2 : 2 jours déclarés, le client n'en reconnaît qu'un et conteste l'autre.
    authAs(ids.provider);
    const r2 = await expectOk(
      await attendancePost(
        postReq({ periodStart: "2026-09-07T00:00:00.000Z", periodEnd: "2026-09-08T23:59:59.999Z", declaredQuantity: 2 }),
        at(mission.id)
      ),
      "déclaration semaine 2",
      [201]
    );
    const releve2 = (await r2.json()).id as string;

    authAs(ids.client);
    await expectOk(
      await attendanceDecisionPost(postReq({ action: "dispute", approvedQuantity: 1, reason: "Absent le 8 septembre" }), {
        params: Promise.resolve({ id: mission.id, attendanceId: releve2 }),
      }),
      "contestation"
    );
    expect((await pspConfirmsPending(contractId)).sort()).toEqual(["freeze", "release"]);
    expect(await goldenRules(contractId)).toMatchObject({ released: 35_000, blocked: 7_000 });

    // Tant que le litige est ouvert, le chantier ne peut pas être clôturé.
    const tropTot = await timeClosePost(postReq({}), at(mission.id));
    expect(tropTot.status).toBe(409);
    expect((await tropTot.json()).error).toBe("attendance_pending");

    // Arbitrage : la journée contestée est écartée, le gel est levé.
    await expectOk(
      await attendanceDecisionPost(postReq({ action: "resolve", accept: false }), {
        params: Promise.resolve({ id: mission.id, attendanceId: releve2 }),
      }),
      "arbitrage"
    );
    expect(await pspConfirmsPending(contractId)).toEqual(["unfreeze"]);
    expect(await goldenRules(contractId)).toMatchObject({ blocked: 0, available: 105_000 });

    // Compte vu par le prestataire : ses deux versements, reçus.
    authAs(ids.provider);
    const compte = await (await expectOk(await balanceGet(getReq(), at(mission.id)), "compte prestataire")).json();
    expect(compte.role).toBe("provider");
    expect(compte.payables.filter((p: { status: string }) => p.status === "paid")).toHaveLength(2);

    // Seul le client clôt.
    expect((await timeClosePost(postReq({}), at(mission.id))).status).toBe(404);

    // Clôture : les 105 000 non consommés reviennent au client.
    authAs(ids.client);
    const cloture = await (await expectOk(await timeClosePost(postReq({}), at(mission.id)), "clôture du chantier")).json();
    expect(cloture).toEqual({ ok: true, refunded: 105_000 });
    expect(await pspConfirmsPending(contractId)).toEqual(["refund"]);
    expect(await goldenRules(contractId)).toMatchObject({ funded: 140_000, released: 35_000, refunded: 105_000, held: 0 });
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("cloturee");

    // Plus aucune présence ne se déclare sur un chantier clos.
    authAs(ids.provider);
    const apres = await attendancePost(
      postReq({ periodStart: "2026-09-14T00:00:00.000Z", periodEnd: "2026-09-14T23:59:59.999Z", declaredQuantity: 1 }),
      at(mission.id)
    );
    expect(apres.status).toBe(409);
    await snapshotRow("S2J — au temps", contractId, mission.id);
  }, LONG);
});

// ── P5 — Médiation ────────────────────────────────────────────────────────────────────────────

describe("P5 — Médiation : gel, répartition à trois destinations, accord", () => {
  it("100 000 gelés → 60 000 au prestataire, 30 000 au client, 10 000 maintenus bloqués", async () => {
    const mission = await publish({ titre: `WF Médiation ${RUN}`, budgetType: "FIXED", budget: 100_000, financingModeKey: "F2" });
    contracts.MED.missionId = mission.id;
    await applyAndAccept(mission.id, { montant: 100_000 });
    const contractId = await contractAndSignatures(mission.id);
    contracts.MED.contractId = contractId;
    await fundWholeContract(mission.id, contractId);

    // Le prestataire ouvre une médiation : tout le séquestre est gelé.
    authAs(ids.provider);
    const ouverture = await (await expectOk(await mediationPost(postReq({ reason: "Livraison contestée par le client" }), at(mission.id)), "ouverture de médiation")).json();
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("mediation_ouverte");
    expect(await pspConfirmsPending(contractId)).toEqual(["freeze"]);
    expect(await goldenRules(contractId)).toMatchObject({ blocked: 100_000, available: 0 });

    // L'admin médiation propose ; une répartition supérieure au séquestre serait refusée.
    authAs(ids.mediator);
    const excessive = await proposeResolutionPost(
      postReq({ proposedResolution: "Répartition impossible", justification: "Test de borne", resolutionAmount: 90_000, refundAmount: 20_000 }),
      at(ouverture.id)
    );
    expect(excessive.status).toBe(400);
    await expectOk(
      await proposeResolutionPost(
        postReq({
          proposedResolution: "Livraison partielle reconnue : 60 % au prestataire, 30 % remboursés, 10 % bloqués.",
          justification: "Constat des pièces des deux parties",
          resolutionAmount: 60_000,
          refundAmount: 30_000,
        }),
        at(ouverture.id)
      ),
      "proposition"
    );

    // Les deux parties acceptent.
    authAs(ids.client);
    await expectOk(await respondResolutionPost(postReq({ accept: true }), at(ouverture.id)), "accord client");
    authAs(ids.provider);
    const accord = await (await expectOk(await respondResolutionPost(postReq({ accept: true }), at(ouverture.id)), "accord prestataire")).json();
    expect(accord).toMatchObject({ outcome: "agreement", releasedAmount: 60_000, refundedAmount: 30_000 });

    expect((await pspConfirmsPending(contractId)).sort()).toEqual(["refund", "release", "unfreeze"]);
    expect(await goldenRules(contractId)).toMatchObject({
      funded: 100_000,
      released: 60_000,
      refunded: 30_000,
      held: 10_000,
      blocked: 10_000,
      available: 0,
    });
    await snapshotRow("Médiation — accord", contractId, mission.id);
  }, LONG);
});

// ── P6 — Console admin & journal PSP ──────────────────────────────────────────────────────────

describe("P6 — ce que voient l'administration, le client et le prestataire", () => {
  it("console financière : les 5 contrats, aucune règle d'or violée, le reliquat bloqué signalé", async () => {
    authAs(ids.supervisor);
    const snap = await (await expectOk(await financeGet(), "console financière")).json();
    const nos = Object.values(contracts).map((c) => c.contractId);

    const rows = (snap.rows as ContractFinanceRow[]).filter((r) => nos.includes(r.contractId));
    expect(rows).toHaveLength(5);
    for (const r of rows) {
      expect(r.violations).toEqual([]);
      expect(Math.abs(r.balance.funded - (r.balance.released + r.balance.refunded + r.balance.held))).toBeLessThan(0.01);
    }

    const anomalies = (snap.anomalies as Anomaly[]).filter((a) => a.contractId && nos.includes(a.contractId));
    expect(anomalies.some((a) => a.kind === "invariant_violation")).toBe(false);
    // Les 10 000 « maintenus bloqués » par l'accord n'ont plus de médiation ouverte pour les lever :
    // la console doit les montrer à l'opérateur.
    expect(anomalies.filter((a) => a.contractId === contracts.MED.contractId).map((a) => a.kind)).toContain("orphan_freeze");
    // Les parcours menés à terme ne laissent rien derrière eux.
    for (const key of ["F2", "J4", "S1", "S2J"] as const) {
      expect(anomalies.filter((a) => a.contractId === contracts[key].contractId)).toEqual([]);
    }
  }, LONG);

  it("journal PSP : chaque instruction transmise et chaque confirmation reçue sont tracées", async () => {
    const nos = Object.values(contracts).map((c) => c.contractId);
    const confirmees = await prisma.pspEscrowOperation.count({ where: { contractId: { in: nos }, status: "confirmed" } });
    const tracees = await prisma.pspEventLog.count({
      where: { contractId: { in: nos }, outcome: "applied", channel: "virtual_console" },
    });
    expect(tracees).toBe(confirmees);
    expect(await prisma.pspEventLog.count({ where: { contractId: { in: nos }, outcome: "rejected" } })).toBe(0);

    authAs(ids.supervisor);
    const page = await (
      await expectOk(
        await journalGet(getReq(`http://localhost/api?period=all&limit=200&q=${contracts.S2J.contractId}`)),
        "journal PSP"
      )
    ).json();
    const items = page.items as JournalItem[];
    const opsS2 = await prisma.pspEscrowOperation.count({ where: { contractId: contracts.S2J.contractId } });
    expect(items.filter((i) => i.kind === "outbound")).toHaveLength(opsS2);
    // hold, 2 versements, gel, dégel, remboursement : 6 confirmations reçues, toutes appliquées.
    expect(items.filter((i) => i.kind === "inbound" && i.outcome === "applied")).toHaveLength(6);
  }, LONG);

  it("tableaux de bord : les paiements du client et ce qui reste dû au prestataire", async () => {
    authAs(ids.client);
    const paiements = await (await expectOk(await clientPaymentsGet(), "paiements client")).json();
    const nosMissions = Object.values(contracts).map((c) => c.missionId);
    const lignes = paiements.items.filter((i: { missionId: string }) => nosMissions.includes(i.missionId));
    expect(lignes).toHaveLength(5);
    expect(lignes.find((l: { missionId: string }) => l.missionId === contracts.S2J.missionId)).toMatchObject({
      isTimeContract: true,
      funded: 140_000,
      released: 35_000,
      refunded: 105_000,
    });

    authAs(ids.provider);
    const resume = await (await expectOk(await providerSummaryGet(), "résumé prestataire")).json();
    // Les versements confirmés comptent dans les revenus ; les 10 000 bloqués par la médiation
    // restent visibles comme gelés, et rien d'autre ne lui est dû.
    expect(resume.stats.revenueTotal).toBeGreaterThanOrEqual(120_000 + 200_000 + 150_000 + 35_000 + 60_000);
    expect(resume.escrow).toMatchObject({ blocked: 10_000, owed: 0, awaitingFunding: 0 });
  }, LONG);
});
