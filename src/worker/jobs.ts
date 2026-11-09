import { loadFinanceSnapshot } from "@/lib/admin-finance";
import { emailQueueHealth, purgeSentEmails } from "@/lib/mail-queue";
import { evaluateAlerts, signalsFromFinance, signalsFromQueues } from "@/lib/ops-alerts";
import { retryDuePayables } from "@/lib/psp/payable-retry";
import { paymentQueueHealth, reconcileStaleOperations } from "@/lib/psp/reconcile";
import { findContractsWithResidual, refundResidualForContract } from "@/lib/residual-refund";
import {
  cleanupDraftAttachments,
  expireDevisNegotiations,
  expireGigOrders,
  expireUnsignedContracts,
} from "@/lib/scheduled-tasks";
import { findDueTacitContractIds, runTacitAcceptanceForContract } from "@/lib/tacit-acceptance";
import { pruneHeartbeats } from "@/lib/worker-heartbeat";

// ---------------------------------------------------------------------------
// Registre des tâches du worker (2026-10-01).
//
// Deux sortes de tâches :
//
//   - PLANIFIÉES (cron pg-boss, politique `singleton`) : une seule exécution à la fois, quelle
//     que soit le nombre de répliques. Les petites tâches s'exécutent en entier.
//
//   - RÉPARTIES : les balayages qui déplacent de l'argent (acceptation tacite, reliquats) ne
//     traitent plus tout dans une seule exécution. Leur tâche planifiée se contente de SÉLECTIONNER
//     en base les contrats concernés, puis dépose un job par contrat (`fanOut`). Les jobs par
//     contrat sont consommés en parallèle (ITEM_CONCURRENCY) avec reprise automatique — un contrat
//     en échec ne bloque plus les suivants, et le débit croît avec le nombre de répliques.
//     Politique `stately` + clé = id du contrat : jamais deux jobs en attente ni deux traitements
//     simultanés du même contrat (ils se disputeraient son verrou pour rien).
// ---------------------------------------------------------------------------

export type ScheduledJob = {
  name: string;
  cron: string;
  run: () => Promise<unknown>;
  /** Tâche répartie : la sélection produit des ids, chacun devient un job de `itemQueue`. */
  fanOut?: { itemQueue: string; select: () => Promise<string[]> };
};

export type ItemJob = { name: string; run: (id: string) => Promise<unknown> };

export const ITEM_JOBS: Record<"tacit" | "residual", ItemJob> = {
  tacit: { name: "tacit-acceptance-contract", run: (contractId) => runTacitAcceptanceForContract(contractId) },
  residual: { name: "residual-refund-contract", run: (contractId) => refundResidualForContract(contractId) },
};

/** Bilan des files + alertes (ouverture, rappel, résolution) — portée `queues.`. */
export async function queuesHealth() {
  const [payments, emails] = await Promise.all([paymentQueueHealth(), emailQueueHealth()]);
  const signals = signalsFromQueues(payments, emails);
  const alerts = await evaluateAlerts("queues.", signals);
  return { alert: signals.length > 0, payments, emails, alerts };
}

/** Règles d'or du séquestre et autres anomalies CRITIQUES du registre — portée `finance.`. */
export async function financeCheck() {
  const snapshot = await loadFinanceSnapshot();
  const signals = signalsFromFinance(snapshot.anomalies);
  return { critical: signals.length, alerts: await evaluateAlerts("finance.", signals) };
}

const noop = async () => undefined;

export const SCHEDULED_JOBS: ScheduledJob[] = [
  // ── Paiements ──
  { name: "psp-reconcile", cron: "*/5 * * * *", run: () => reconcileStaleOperations() },
  { name: "payables-retry", cron: "* * * * *", run: () => retryDuePayables() },
  // ── Échéances (anciennement /api/cron/*) ──
  { name: "contract-expirations", cron: "*/10 * * * *", run: expireUnsignedContracts },
  { name: "devis-expirations", cron: "*/10 * * * *", run: expireDevisNegotiations },
  { name: "gig-order-expirations", cron: "*/10 * * * *", run: expireGigOrders },
  // Toutes les heures et non plus une fois par jour : la sélection ne charge que les contrats
  // échus, une passe à vide ne coûte qu'une requête indexée. Le prestataire est payé dans l'heure
  // qui suit l'échéance, au lieu d'attendre jusqu'à 24 h.
  {
    name: "tacit-acceptance",
    cron: "5 * * * *",
    run: noop,
    fanOut: { itemQueue: ITEM_JOBS.tacit.name, select: () => findDueTacitContractIds() },
  },
  {
    name: "residual-refunds",
    cron: "30 3 * * *",
    run: noop,
    fanOut: { itemQueue: ITEM_JOBS.residual.name, select: () => findContractsWithResidual() },
  },
  // ── Entretien ──
  { name: "draft-attachments-cleanup", cron: "0 4 * * *", run: cleanupDraftAttachments },
  { name: "emails-purge", cron: "30 4 * * *", run: () => purgeSentEmails() },
  { name: "worker-heartbeats-prune", cron: "45 4 * * *", run: () => pruneHeartbeats() },
  // ── Supervision ──
  { name: "queues-health", cron: "*/5 * * * *", run: queuesHealth },
  { name: "finance-check", cron: "15 * * * *", run: financeCheck },
];
