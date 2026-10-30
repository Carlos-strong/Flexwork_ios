/**
 * Files des paiements (2026-10-01) — boîte d'envoi, boîte de réception, reprise, rapprochement.
 *
 * Ce que ce fichier verrouille :
 *   1. une instruction n'est transmise qu'UNE fois, même réclamée en parallèle ; un échec de
 *      transmission est repris avec délai croissant, puis abandonné et visible ;
 *   2. en mode `worker`, la requête n'attend plus le PSP — sauf pour un financement ;
 *   3. un webhook est consigné puis appliqué une seule fois, même rappelé ; un webhook arrivé avant
 *      son opération est repris ; une signature fausse n'écrit rien ;
 *   4. deux dénouements simultanés de la même opération : un seul gagne ;
 *   5. seule une créance de présence refusée est reprise automatiquement ;
 *   6. une opération restée en attente est rapprochée auprès du PSP par le chemin signé.
 */

import { describe, expect, it, beforeAll, afterAll, afterEach } from "vitest";
import { POST as webhookPost } from "@/app/api/webhooks/psp/route";
import { prisma } from "@/lib/db";
import { applyPspWebhookEvent } from "@/lib/psp-webhook";
import { setPspAdapterForTests, type PspAdapter, type PspInstruction, type PspRemoteStatus } from "@/lib/psp/adapter";
import { afterInstructionCommitted, dispatchDueOperations, dispatchOperation, MAX_DISPATCH_ATTEMPTS } from "@/lib/psp/dispatch";
import { processInboundEvent } from "@/lib/psp/inbox";
import { retryDuePayables } from "@/lib/psp/payable-retry";
import { paymentQueueHealth, reconcileStaleOperations } from "@/lib/psp/reconcile";
import { signWebhookPayload } from "@/lib/webhook-signing";
import { runWorkerTick } from "@/worker/tick";

const RUN = Date.now();
const TAG = `queue_${RUN}`;
let seq = 0;
const ref = (kind: string) => `${kind}_${TAG}_${++seq}`;

let clientId = "";
let providerId = "";
let missionId = "";
let contractId = "";

/** PSP de test : consigne ce qu'on lui transmet, échoue ou répond sur commande. */
function fakePsp(opts: { fail?: boolean; status?: PspRemoteStatus; delayMs?: number } = {}) {
  const sent: PspInstruction[] = [];
  const adapter: PspAdapter = {
    name: "fake",
    async sendInstruction(instruction) {
      if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs));
      if (opts.fail) throw new Error("psp_unreachable");
      sent.push(instruction);
    },
    async fetchStatus() {
      return opts.status ?? null;
    },
  };
  setPspAdapterForTests(adapter);
  return sent;
}

const createOp = (instructionType: "hold" | "release" | "refund", extra: object = {}) =>
  prisma.pspEscrowOperation.create({
    data: {
      contractId,
      pspName: "psp-test",
      pspReference: ref(instructionType),
      amount: 10_000,
      currency: "XOF",
      instructionType,
      ...extra,
    },
  });

function webhook(payload: { pspReference: string; event: string }, signature?: string) {
  return webhookPost(
    new Request("http://localhost/api/webhooks/psp", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-webhook-signature": signature ?? signWebhookPayload(payload) },
      body: JSON.stringify(payload),
    })
  );
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;
  const mk = (suffix: string, role: "client" | "artisan") =>
    prisma.user.create({
      data: { email: `e2e-queue-${suffix}-${RUN}@flexwork.test`, tel: `+229${RUN}8${suffix.length}`, role, status: "active", country: "BJ" },
    });
  clientId = (await mk("c", "client")).id;
  providerId = (await mk("pr", "artisan")).id;
  const mission = await prisma.mission.create({
    data: { clientId, titre: `Files PSP ${RUN}`, description: "Mission e2e des files de paiement", domaine: "batiment", budget: 100_000, currency: "XOF", delaiJours: 30, status: "fonds_sous_sequestre" },
  });
  missionId = mission.id;
  contractId = (
    await prisma.prestationContract.create({
      data: {
        missionId,
        clientId,
        providerId,
        termsSnapshot: { prix: 100_000, devise: "XOF" },
        currentHash: `hash-queue-${RUN}`,
        clientSignedAt: new Date(),
        providerSignedAt: new Date(),
      },
    })
  ).id;
  // Séquestre déjà financé : les reprises de créances ont de quoi être couvertes.
  await createOp("hold", { amount: 1_000_000, status: "confirmed", dispatchStatus: "envoyee", dispatchedAt: new Date() });
});

afterEach(() => {
  setPspAdapterForTests(null);
  delete process.env.QUEUE_MODE;
});

afterAll(async () => {
  await prisma.pspInboundEvent.deleteMany({ where: { pspReference: { contains: TAG } } });
  await prisma.pspEventLog.deleteMany({ where: { pspReference: { contains: TAG } } });
  await prisma.payable.deleteMany({ where: { contractId } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId } });
  await prisma.prestationContract.deleteMany({ where: { id: contractId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("boîte d'envoi — transmission des instructions", () => {
  it("transmet une fois, puis ne réclame plus la ligne", async () => {
    const sent = fakePsp();
    const op = await createOp("release");
    expect(await dispatchOperation(op.id)).toBe("sent");
    expect(await dispatchOperation(op.id)).toBe("not_claimed");
    expect(sent.map((s) => s.pspReference)).toEqual([op.pspReference]);
    const after = await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: op.id } });
    expect(after).toMatchObject({ dispatchStatus: "envoyee", dispatchAttempts: 1, status: "pending" });
    expect(after.dispatchedAt).not.toBeNull();
  });

  it("deux transmetteurs simultanés : une seule transmission", async () => {
    const sent = fakePsp({ delayMs: 50 });
    const op = await createOp("release");
    const outcomes = await Promise.all([dispatchOperation(op.id), dispatchOperation(op.id), dispatchOperation(op.id)]);
    expect(outcomes.filter((o) => o === "sent")).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("échec de transmission : reprise différée, puis abandon visible", async () => {
    fakePsp({ fail: true });
    const op = await createOp("refund");
    expect(await dispatchOperation(op.id)).toBe("retry_scheduled");
    let row = await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: op.id } });
    expect(row).toMatchObject({ dispatchStatus: "a_envoyer", dispatchAttempts: 1, lastDispatchError: "psp_unreachable" });
    expect(row.nextDispatchAt.getTime()).toBeGreaterThan(Date.now());
    // Pas encore échue : le tour du worker la laisse.
    expect(await dispatchOperation(op.id)).toBe("not_claimed");

    await prisma.pspEscrowOperation.update({
      where: { id: op.id },
      data: { nextDispatchAt: new Date(Date.now() - 1000), dispatchAttempts: MAX_DISPATCH_ATTEMPTS - 1 },
    });
    expect(await dispatchOperation(op.id)).toBe("abandoned");
    row = await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: op.id } });
    expect(row.dispatchStatus).toBe("echec_envoi");
    expect((await paymentQueueHealth()).outboxAbandoned).toBeGreaterThanOrEqual(1);
  });

  it("un transmetteur mort libère la ligne à l'expiration de son bail", async () => {
    const sent = fakePsp();
    const op = await createOp("release", { dispatchStatus: "en_cours", dispatchLeaseUntil: new Date(Date.now() - 1000), dispatchAttempts: 1 });
    await dispatchDueOperations();
    expect(sent.map((s) => s.id)).toContain(op.id);
    expect((await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: op.id } })).dispatchAttempts).toBe(2);
  });

  it("mode worker : la requête ne transmet pas, sauf un financement", async () => {
    process.env.QUEUE_MODE = "worker";
    const sent = fakePsp();
    const release = await createOp("release");
    const hold = await createOp("hold");
    await afterInstructionCommitted(release);
    await afterInstructionCommitted(hold);
    expect(sent.map((s) => s.id)).toEqual([hold.id]);
    expect((await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: release.id } })).dispatchStatus).toBe("a_envoyer");

    await runWorkerTick();
    expect(sent.map((s) => s.id)).toContain(release.id);
  });
});

describe("boîte de réception — webhooks", () => {
  it("mode worker : consigné et acquitté, appliqué par le worker, une seule fois", async () => {
    process.env.QUEUE_MODE = "worker";
    fakePsp();
    const op = await createOp("release", { dispatchStatus: "envoyee", dispatchedAt: new Date() });
    const payload = { pspReference: op.pspReference!, event: "release_confirmed" };

    const first = await webhook(payload);
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ received: true, queued: true });
    expect((await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: op.id } })).status).toBe("pending");

    const again = await webhook(payload);
    expect(await again.json()).toEqual({ received: true, duplicate: true });
    expect(await prisma.pspInboundEvent.count({ where: { pspReference: op.pspReference! } })).toBe(1);

    await runWorkerTick();
    expect((await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: op.id } })).status).toBe("confirmed");
    const row = await prisma.pspInboundEvent.findFirstOrThrow({ where: { pspReference: op.pspReference! } });
    expect(row).toMatchObject({ status: "traite", attempts: 1, rawBody: JSON.stringify(payload) });
    const applied = await prisma.pspEventLog.count({ where: { pspReference: op.pspReference!, outcome: "applied" } });
    expect(applied).toBe(1);
  });

  it("signature fausse : refusée, rien n'est consigné dans la boîte", async () => {
    process.env.QUEUE_MODE = "worker";
    const reference = ref("release");
    const res = await webhook({ pspReference: reference, event: "release_confirmed" }, "deadbeef");
    expect(res.status).toBe(409);
    expect(await prisma.pspInboundEvent.count({ where: { pspReference: reference } })).toBe(0);
  });

  it("webhook arrivé avant son opération : repris, puis appliqué", async () => {
    process.env.QUEUE_MODE = "worker";
    const reference = ref("release");
    await webhook({ pspReference: reference, event: "release_confirmed" });
    const row = await prisma.pspInboundEvent.findFirstOrThrow({ where: { pspReference: reference } });

    expect(await processInboundEvent(row.id)).toEqual({ ok: false, error: "operation_not_found" });
    let after = await prisma.pspInboundEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(after).toMatchObject({ status: "recu", attempts: 1, lastError: "operation_not_found" });
    expect(after.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    const op = await createOp("release", { pspReference: reference, dispatchStatus: "envoyee", dispatchedAt: new Date() });
    await prisma.pspInboundEvent.update({ where: { id: row.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    expect(await processInboundEvent(row.id)).toEqual({ ok: true });
    after = await prisma.pspInboundEvent.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.status).toBe("traite");
    expect((await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: op.id } })).status).toBe("confirmed");
  });

  it("dénouement contradictoire : rejeté définitivement, pas repris", async () => {
    process.env.QUEUE_MODE = "worker";
    const op = await createOp("release", { status: "confirmed", dispatchStatus: "envoyee", dispatchedAt: new Date() });
    await webhook({ pspReference: op.pspReference!, event: "failed" });
    const row = await prisma.pspInboundEvent.findFirstOrThrow({ where: { pspReference: op.pspReference! } });
    await processInboundEvent(row.id);
    expect(await prisma.pspInboundEvent.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({
      status: "rejete",
      lastError: "operation_already_settled",
    });
  });
});

describe("dénouement atomique", () => {
  it("la même confirmation livrée deux fois en même temps : appliquée une fois", async () => {
    const op = await createOp("refund", { dispatchStatus: "envoyee", dispatchedAt: new Date() });
    const payload = { pspReference: op.pspReference!, event: "refund_confirmed" as const };
    const sig = signWebhookPayload(payload);
    const results = await Promise.all([applyPspWebhookEvent(payload, sig), applyPspWebhookEvent(payload, sig)]);
    expect(results.filter((r) => r.ok && !r.replayed)).toHaveLength(1);
    expect(results.filter((r) => r.ok && r.replayed)).toHaveLength(1);
  });

  it("confirmation et échec simultanés : un seul dénouement l'emporte", async () => {
    const op = await createOp("refund", { dispatchStatus: "envoyee", dispatchedAt: new Date() });
    const ok = { pspReference: op.pspReference!, event: "refund_confirmed" as const };
    const ko = { pspReference: op.pspReference!, event: "failed" as const };
    const [a, b] = await Promise.all([applyPspWebhookEvent(ok, signWebhookPayload(ok)), applyPspWebhookEvent(ko, signWebhookPayload(ko))]);
    expect([a, b].filter((r) => r.ok)).toHaveLength(1);
    expect([a, b].filter((r) => !r.ok && r.error === "operation_already_settled")).toHaveLength(1);
    const final = await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: op.id } });
    expect(final.status).toBe(a.ok ? "confirmed" : "failed");
  });
});

describe("reprise des créances refusées", () => {
  async function instructedPayable(sourceType: "attendance" | "jalon") {
    const op = await createOp("release", { dispatchStatus: "envoyee", dispatchedAt: new Date() });
    const payable = await prisma.payable.create({
      data: {
        contractId,
        missionId,
        sourceType,
        sourceId: `${sourceType}_${TAG}_${seq}`,
        amount: 10_000,
        currency: "XOF",
        status: "instructed",
        escrowOperationId: op.id,
        idempotencyKey: `${TAG}:${sourceType}:${seq}`,
      },
    });
    return { op, payable };
  }
  const fail = (reference: string) => {
    const payload = { pspReference: reference, event: "failed" as const };
    return applyPspWebhookEvent(payload, signWebhookPayload(payload));
  };

  it("créance de présence : reprise programmée puis réinstruite", async () => {
    fakePsp();
    const { op, payable } = await instructedPayable("attendance");
    expect((await fail(op.pspReference!)).ok).toBe(true);
    let row = await prisma.payable.findUniqueOrThrow({ where: { id: payable.id } });
    expect(row.status).toBe("failed");
    expect(row.nextRetryAt!.getTime()).toBeGreaterThan(Date.now() + 4 * 60_000);

    await prisma.payable.update({ where: { id: payable.id }, data: { nextRetryAt: new Date(Date.now() - 1000) } });
    expect((await retryDuePayables()).instructed).toBeGreaterThanOrEqual(1);
    row = await prisma.payable.findUniqueOrThrow({ where: { id: payable.id } });
    expect(row).toMatchObject({ status: "instructed", retryCount: 1, nextRetryAt: null });
    expect(row.escrowOperationId).not.toBe(op.id);
  });

  it("créance de jalon : aucune reprise automatique (le client revalide)", async () => {
    const { op, payable } = await instructedPayable("jalon");
    await fail(op.pspReference!);
    const row = await prisma.payable.findUniqueOrThrow({ where: { id: payable.id } });
    expect(row).toMatchObject({ status: "failed", nextRetryAt: null });
  });
});

describe("rapprochement des opérations restées en attente", () => {
  it("le PSP répond « confirmé » : appliqué par le chemin signé, canal dédié", async () => {
    fakePsp({ status: "confirmed" });
    const op = await createOp("refund", { dispatchStatus: "envoyee", dispatchedAt: new Date(Date.now() - 60 * 60_000) });
    const counts = await reconcileStaleOperations();
    expect(counts.applied).toBeGreaterThanOrEqual(1);
    expect((await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: op.id } })).status).toBe("confirmed");
    const log = await prisma.pspEventLog.findFirstOrThrow({ where: { pspReference: op.pspReference! } });
    expect(log).toMatchObject({ channel: "reconciliation", outcome: "applied", signatureValid: true });
  });

  it("une opération récente n'est pas relue", async () => {
    fakePsp({ status: "failed" });
    const op = await createOp("refund", { dispatchStatus: "envoyee", dispatchedAt: new Date() });
    await reconcileStaleOperations();
    expect((await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: op.id } })).status).toBe("pending");
  });
});
