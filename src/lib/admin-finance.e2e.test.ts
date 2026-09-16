/**
 * Console financière admin (2026-09-15).
 *
 * Ce que ce fichier verrouille :
 *   1. les ANOMALIES — chaque état « argent immobilisé sans issue » que le moteur sait produire est
 *      détecté, et un état légitime (gel sous médiation ouverte, instruction récente) ne l'est pas ;
 *   2. la COHÉRENCE — les chiffres de la console sont ceux du compte des parties (même fonction), et
 *      l'identité comptable tient ligne par ligne ;
 *   3. les POUVOIRS — lire est ouvert au Superviseur et à la Médiation, faire sortir des fonds est
 *      réservé à la Médiation, exige une justification, et laisse une trace au journal d'audit.
 *
 * Mode CONSOLE (pas d'autoconfirm) : le remboursement instruit reste `pending`, comme en production.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { GET as financeGet } from "@/app/api/admin/finance/route";
import { GET as operationsGet } from "@/app/api/admin/finance/operations/route";
import { GET as payablesGet } from "@/app/api/admin/finance/payables/route";
import { GET as contractGet } from "@/app/api/admin/finance/contracts/[contractId]/route";
import { POST as sweepPost } from "@/app/api/admin/finance/residual-sweep/route";
import { POST as refundPost } from "@/app/api/admin/contracts/[contractId]/refund/route";
import { prisma } from "@/lib/db";
import {
  contractAnomalies,
  loadFinanceSnapshot,
  staleInstructionAnomalies,
  type Anomaly,
  type ContractFinanceRow,
  type FinanceSnapshot,
} from "@/lib/admin-finance";

const RUN = Date.now();
const HOUR = 60 * 60 * 1000;

let clientId = "";
let providerId = "";
let mediatorId = "";
let supervisorId = "";
let plainUserId = "";
const missionIds: string[] = [];
const contracts: Record<"residual" | "freeze" | "failed" | "unfunded" | "violation", string> = {
  residual: "",
  freeze: "",
  failed: "",
  unfunded: "",
  violation: "",
};
let failedOperationId = "";

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

let seq = 0;
type OpSpec = { type: "hold" | "release" | "refund" | "freeze"; amount: number; status?: "pending" | "confirmed" | "failed"; sentAt?: Date };

async function createContract(missionStatus: string, ops: OpSpec[]) {
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Console finance ${RUN} #${++seq}`,
      description: "Mission e2e de la console financière admin",
      domaine: "batiment",
      budget: 100_000,
      currency: "XOF",
      delaiJours: 30,
      status: missionStatus as "cloturee",
    },
  });
  missionIds.push(mission.id);
  const contract = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId,
      providerId,
      termsSnapshot: { prix: 100_000, devise: "XOF" },
      currentHash: `hash-finance-${RUN}-${seq}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      escrowOperations: {
        create: ops.map((op, i) => ({
          pspName: "psp-virtuelle",
          pspReference: `${op.type}_finance_${RUN}_${seq}_${i}`,
          amount: op.amount,
          currency: "XOF",
          instructionType: op.type,
          status: op.status ?? "confirmed",
          ...(op.sentAt ? { instructionSentAt: op.sentAt } : {}),
        })),
      },
    },
  });
  return contract.id;
}

const kindsFor = (snap: FinanceSnapshot, contractId: string) =>
  snap.anomalies.filter((a) => a.contractId === contractId).map((a) => a.kind);

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const mk = (suffix: string, extra: object = {}) =>
    prisma.user.create({
      data: { email: `e2e-finance-${suffix}-${RUN}@flexwork.test`, tel: `+229${RUN}${suffix.length}${seq++}`, role: "client", status: "active", country: "BJ", ...extra },
    });
  clientId = (await mk("client")).id;
  providerId = (await mk("provider", { role: "artisan" })).id;
  mediatorId = (await mk("mediator", { isAdmin: true, adminRole: "mediation" })).id;
  supervisorId = (await mk("supervisor", { isAdmin: true, adminRole: "superviseur" })).id;
  plainUserId = (await mk("plain")).id;

  // Reliquat de 40 000 sur une mission CLÔTURÉE.
  contracts.residual = await createContract("cloturee", [
    { type: "hold", amount: 100_000 },
    { type: "release", amount: 60_000 },
  ]);

  // Gel de 20 000 sans médiation ni relevé contesté.
  contracts.freeze = await createContract("fonds_sous_sequestre", [
    { type: "hold", amount: 50_000 },
    { type: "freeze", amount: 20_000 },
  ]);

  // Versement refusé par le PSP + versement jamais confirmé depuis 48 h.
  contracts.failed = await createContract("en_cours", [
    { type: "hold", amount: 80_000 },
    { type: "release", amount: 30_000, status: "failed" },
    { type: "release", amount: 10_000, status: "pending", sentAt: new Date(Date.now() - 48 * HOUR) },
  ]);
  const failedOp = await prisma.pspEscrowOperation.findFirstOrThrow({ where: { contractId: contracts.failed, status: "failed" } });
  failedOperationId = failedOp.id;
  await prisma.payable.create({
    data: {
      contractId: contracts.failed,
      sourceType: "mission",
      sourceId: contracts.failed,
      amount: 30_000,
      status: "failed",
      idempotencyKey: `finance-failed-${RUN}`,
      escrowOperationId: failedOp.id,
    },
  });

  // Créance validée de 30 000 sur un séquestre de 10 000 : 20 000 non couverts.
  contracts.unfunded = await createContract("livrable_soumis", [{ type: "hold", amount: 10_000 }]);
  await prisma.payable.create({
    data: {
      contractId: contracts.unfunded,
      sourceType: "mission",
      sourceId: contracts.unfunded,
      amount: 30_000,
      status: "validated",
      idempotencyKey: `finance-unfunded-${RUN}`,
    },
  });

  // Créance « payée » sans aucune instruction : un paiement hors registre, règle 1 violée.
  contracts.violation = await createContract("en_cours", [{ type: "hold", amount: 5_000 }]);
  await prisma.payable.create({
    data: {
      contractId: contracts.violation,
      sourceType: "mission",
      sourceId: contracts.violation,
      amount: 5_000,
      status: "paid",
      idempotencyKey: `finance-violation-${RUN}`,
    },
  });
});

afterAll(async () => {
  const ids = Object.values(contracts).filter(Boolean);
  await prisma.adminAuditLog.deleteMany({ where: { adminId: { in: [mediatorId, supervisorId] } } });
  await prisma.payable.deleteMany({ where: { contractId: { in: ids } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId: { in: ids } } });
  await prisma.prestationContract.deleteMany({ where: { id: { in: ids } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId, mediatorId, supervisorId, plainUserId] } } });
});

describe("anomalies — chaque fonds immobilisé sans issue est repéré", () => {
  let snap: FinanceSnapshot;
  beforeAll(async () => {
    snap = await loadFinanceSnapshot();
  });

  it("reliquat sur mission close", () => {
    const a = snap.anomalies.find((x) => x.contractId === contracts.residual && x.kind === "residual_on_closed");
    expect(a?.amount).toBe(40_000);
  });

  it("gel sans médiation ni contestation", () => {
    const a = snap.anomalies.find((x) => x.contractId === contracts.freeze && x.kind === "orphan_freeze");
    expect(a?.amount).toBe(20_000);
  });

  it("versement refusé et instruction non confirmée depuis 48 h — tous deux critiques", () => {
    const list = snap.anomalies.filter((x) => x.contractId === contracts.failed);
    expect(list.map((x) => x.kind).sort()).toEqual(["failed_payout", "stale_instruction"]);
    expect(list.every((x) => x.severity === "critical")).toBe(true);
  });

  it("créance non couverte par le séquestre", () => {
    const a = snap.anomalies.find((x) => x.contractId === contracts.unfunded && x.kind === "unfunded_payable");
    expect(a?.amount).toBe(20_000);
  });

  it("règle d'or violée", () => {
    expect(kindsFor(snap, contracts.violation)).toContain("invariant_violation");
  });

  it("les critiques passent en tête de liste", () => {
    const rangs = snap.anomalies.map((a) => ({ critical: 0, warning: 1, info: 2 })[a.severity]);
    expect(rangs).toEqual([...rangs].sort((x, y) => x - y));
  });

  it("identité comptable tenue sur chaque ligne : financé = versé + remboursé + détenu", () => {
    for (const id of Object.values(contracts)) {
      const row = snap.rows.find((r) => r.contractId === id)!;
      const { funded, released, refunded, held } = row.balance;
      expect(Math.abs(funded - (released + refunded + held))).toBeLessThan(0.01);
    }
  });
});

describe("anomalies — un état légitime n'est pas signalé", () => {
  const row = (over: Partial<ContractFinanceRow>) =>
    ({
      contractId: "c",
      missionId: "m",
      titre: "t",
      missionStatus: "en_cours",
      missing: 0,
      hasOpenMediation: false,
      hasDisputedAttendance: false,
      violations: [],
      balance: { funded: 50_000, released: 0, refunded: 0, held: 50_000, blocked: 20_000, retained: 0, releasable: 0, available: 30_000, owedToProvider: 0, refundable: 30_000, contractual: 50_000, fundingPending: false },
      ...over,
    }) as ContractFinanceRow;

  it("un gel sous médiation ouverte, ou sous relevé contesté, est attendu", () => {
    expect(contractAnomalies(row({ hasOpenMediation: true }))).toEqual([]);
    expect(contractAnomalies(row({ hasDisputedAttendance: true }))).toEqual([]);
  });

  it("des fonds disponibles sur une mission EN COURS ne sont pas un reliquat", () => {
    expect(contractAnomalies(row({ hasOpenMediation: true })).some((a: Anomaly) => a.kind === "residual_on_closed")).toBe(false);
  });

  it("une instruction de moins de 24 h n'est pas en souffrance ; un financement non autorisé n'est qu'une information", () => {
    const now = new Date();
    const base = { amount: 1, contractId: "c", orderId: null, missionId: "m", title: "t" };
    expect(staleInstructionAnomalies([{ ...base, id: "a", instructionType: "release", instructionSentAt: new Date(now.getTime() - 23 * HOUR) }], now)).toEqual([]);
    const [hold] = staleInstructionAnomalies([{ ...base, id: "b", instructionType: "hold", instructionSentAt: new Date(now.getTime() - 30 * HOUR) }], now);
    expect(hold.severity).toBe("info");
  });
});

describe("pouvoirs — lire n'est pas agir", () => {
  it("un utilisateur non administrateur est refusé", async () => {
    authAs(plainUserId);
    expect((await financeGet()).status).toBe(403);
  });

  it("le Superviseur lit la console et la fiche d'un contrat", async () => {
    authAs(supervisorId);
    const res = await financeGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.viewerRole).toBe("superviseur");
    expect(body.rows.some((r: ContractFinanceRow) => r.contractId === contracts.residual)).toBe(true);

    const detail = await contractGet(new Request("http://localhost/api"), { params: Promise.resolve({ contractId: contracts.residual }) });
    const d = await detail.json();
    expect(d.actions.refund).toEqual({ available: true, amount: 40_000 });
    expect(d.anomalies.map((a: Anomaly) => a.kind)).toContain("residual_on_closed");
  });

  it("une fiche inexistante répond 404", async () => {
    authAs(supervisorId);
    const res = await contractGet(new Request("http://localhost/api"), { params: Promise.resolve({ contractId: `absent-${RUN}` }) });
    expect(res.status).toBe(404);
  });

  it("le registre et les créances se filtrent", async () => {
    authAs(supervisorId);
    const ops = await (await operationsGet(new Request(`http://localhost/api?status=failed&q=${contracts.failed}`))).json();
    expect(ops.items.map((o: { id: string }) => o.id)).toEqual([failedOperationId]);

    const dues = await (await payablesGet(new Request(`http://localhost/api?status=validated&q=${contracts.unfunded}`))).json();
    expect(dues.items).toHaveLength(1);
    expect(dues.items[0].amount).toBe(30_000);
  });

  it("le Superviseur ne peut ni rembourser ni balayer", async () => {
    authAs(supervisorId);
    const refund = await refundPost(postReq({ justification: "Tentative superviseur" }), { params: Promise.resolve({ contractId: contracts.residual }) });
    expect(refund.status).toBe(403);
    expect((await sweepPost(postReq({ justification: "Tentative superviseur" }))).status).toBe(403);
  });

  it("la Médiation doit justifier son geste", async () => {
    authAs(mediatorId);
    const sansMotif = await refundPost(postReq({}), { params: Promise.resolve({ contractId: contracts.residual }) });
    expect(sansMotif.status).toBe(400);
    expect((await sansMotif.json()).error).toBe("justification_required");
    expect((await sweepPost(postReq({ justification: "" }))).status).toBe(400);
  });

  it("le remboursement justifié rend le reliquat et laisse une trace au journal", async () => {
    authAs(mediatorId);
    const res = await refundPost(postReq({ justification: "Mission close, reliquat au client" }), {
      params: Promise.resolve({ contractId: contracts.residual }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).amount).toBe(40_000);

    const log = await prisma.adminAuditLog.findFirst({
      where: { adminId: mediatorId, action: "escrow_contract_refund", targetId: contracts.residual },
    });
    expect(log?.justification).toContain("Mission close, reliquat au client");

    // Le reliquat est désormais en route : la console ne le signale plus.
    const snap = await loadFinanceSnapshot();
    expect(kindsFor(snap, contracts.residual)).not.toContain("residual_on_closed");
  });
});
