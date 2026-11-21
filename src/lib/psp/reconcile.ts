import { prisma } from "@/lib/db";
import { pspAdapter } from "@/lib/psp/adapter";
import { applyPspWebhookEvent, type PspWebhookPayload } from "@/lib/psp-webhook";
import { eventForInstruction } from "@/lib/psp-virtual";
import { signWebhookPayload } from "@/lib/webhook-signing";

// ---------------------------------------------------------------------------
// Rapprochement des opérations restées en attente (2026-10-01).
//
// Un webhook peut se perdre. Une instruction transmise dont la confirmation n'arrive jamais
// laissait une mission « fonds en cours de séquestre » ou un prestataire « versement en cours »
// pour toujours, sans que personne ne le voie. Le worker relit donc, auprès du PSP, le statut des
// opérations transmises depuis trop longtemps, et applique ce qu'il répond par le MÊME chemin que
// le webhook (charge signée → applyPspWebhookEvent, canal `reconciliation`) : la règle US-503 —
// rien n'avance hors de ce chemin — n'est pas contournée, seule la source de l'information change.
// ---------------------------------------------------------------------------

export const STALE_AFTER_MS = 15 * 60_000;

export type ReconcileCounts = { checked: number; applied: number; stillPending: number; unknown: number };

export async function reconcileStaleOperations(opts: { olderThanMs?: number; limit?: number } = {}): Promise<ReconcileCounts> {
  const before = new Date(Date.now() - (opts.olderThanMs ?? STALE_AFTER_MS));
  const stale = await prisma.pspEscrowOperation.findMany({
    where: {
      sourceType: "mission_contract",
      status: "pending",
      dispatchStatus: "envoyee",
      dispatchedAt: { lt: before },
      pspReference: { not: null },
    },
    orderBy: { dispatchedAt: "asc" },
    take: opts.limit ?? 50,
  });

  const adapter = pspAdapter();
  const counts: ReconcileCounts = { checked: stale.length, applied: 0, stillPending: 0, unknown: 0 };
  for (const op of stale) {
    const remote = await adapter.fetchStatus({ ...op, pspReference: op.pspReference! });
    if (remote === null) {
      counts.unknown++;
      continue;
    }
    if (remote === "pending") {
      counts.stillPending++;
      continue;
    }
    const payload: PspWebhookPayload = {
      pspReference: op.pspReference!,
      event: remote === "failed" ? "failed" : eventForInstruction(op.instructionType),
    };
    const signature = signWebhookPayload(payload as unknown as Record<string, unknown>);
    const result = await applyPspWebhookEvent(payload, signature, "reconciliation");
    if (result.ok) counts.applied++;
  }
  return counts;
}

export type PaymentQueueHealth = {
  /** Instructions écrites, pas encore transmises (dont en retard de plus de 5 min). */
  outboxPending: number;
  outboxLate: number;
  /** Transmissions abandonnées — intervention requise. */
  outboxAbandoned: number;
  /** Webhooks reçus non traités, et ceux en échec technique répété. */
  inboxPending: number;
  inboxFailed: number;
  /** Opérations transmises sans dénouement depuis plus de STALE_AFTER_MS. */
  stalePending: number;
};

/** Instantané pour la supervision : chaque compteur non nul hors `*Pending` mérite une alerte. */
export async function paymentQueueHealth(): Promise<PaymentQueueHealth> {
  const now = Date.now();
  const [outboxPending, outboxLate, outboxAbandoned, inboxPending, inboxFailed, stalePending] = await Promise.all([
    prisma.pspEscrowOperation.count({ where: { status: "pending", dispatchStatus: { in: ["a_envoyer", "en_cours"] } } }),
    prisma.pspEscrowOperation.count({
      where: { status: "pending", dispatchStatus: { in: ["a_envoyer", "en_cours"] }, instructionSentAt: { lt: new Date(now - 5 * 60_000) } },
    }),
    prisma.pspEscrowOperation.count({ where: { status: "pending", dispatchStatus: "echec_envoi" } }),
    prisma.pspInboundEvent.count({ where: { status: { in: ["recu", "en_cours"] } } }),
    prisma.pspInboundEvent.count({ where: { status: "echec" } }),
    prisma.pspEscrowOperation.count({
      where: { status: "pending", dispatchStatus: "envoyee", dispatchedAt: { lt: new Date(now - STALE_AFTER_MS) } },
    }),
  ]);
  return { outboxPending, outboxLate, outboxAbandoned, inboxPending, inboxFailed, stalePending };
}
