import type { EscrowInstructionType, EscrowSourceType, PayableStatus, Prisma, PspOperationStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { escrowBalance, escrowBalancesFor, type EscrowBalance } from "@/lib/escrow";
import { escrowFinancialState, type EscrowFinancialState } from "@/lib/escrow-state";
import { checkBalanceInvariants, type InvariantViolation } from "@/lib/escrow-invariants";
import { IN_FLIGHT_STATUSES, netHeldAmount } from "@/lib/escrow-instructions";
import { totalRetentionAmount } from "@/lib/jalons";
import { buildPayableLabeler } from "@/lib/payable-labels";

// Console financière de l'administration (2026-09-15) — tous les flux du séquestre, lus depuis le
// registre unique (`PspEscrowOperation`) et les créances (`Payable`).
//
// ── Ce que ce module est, et ce qu'il n'est pas ────────────────────────────────────────────
// Une LECTURE. Aucun solde n'y est écrit, aucune instruction n'y est émise : les chiffres sont
// ceux que calculent déjà `escrowBalancesFor` et `checkBalanceInvariants` pour les parties, et
// l'administration doit voir exactement les mêmes. Une console qui recalculerait à sa façon
// finirait par contredire l'écran du client — et personne ne saurait lequel croire.
//
// Les gestes (remboursement, solde de retenue, balayage des reliquats) restent dans leurs routes
// dédiées, gardées par le rôle Médiation et journalisées. La console les propose ; elle ne les
// réimplémente pas.
//
// ── Ce qu'elle apporte ─────────────────────────────────────────────────────────────────────
// Les ANOMALIES : les états que le moteur sait produire mais qu'aucun chemin ne vient résoudre
// seul — un reliquat sur une mission close, un gel sans litige, une instruction jamais confirmée,
// un versement refusé. Chacune est un argent immobilisé qu'aucune des deux parties ne peut
// débloquer ; c'est précisément ce qu'un opérateur doit voir en premier.

export const STALE_INSTRUCTION_HOURS = 24;
const TERMINAL_MISSION_STATUSES: readonly string[] = ["cloturee", "remboursee"];
const TERMINAL_GIG_STATUSES: readonly string[] = ["completed", "refunded", "cancelled"];
const EPSILON = 0.5;
const HOUR_MS = 60 * 60 * 1000;

export type Severity = "critical" | "warning" | "info";

export type AnomalyKind =
  | "invariant_violation" // le registre contredit les règles d'or
  | "stale_instruction" // instruction transmise au PSP, jamais confirmée
  | "failed_payout" // créance dont le versement a été refusé par le PSP
  | "unfunded_payable" // créance validée que le séquestre ne couvre pas
  | "residual_on_closed" // reliquat disponible sur une mission terminée
  | "orphan_freeze" // fonds gelés sans litige ouvert pour les justifier
  | "retention_stuck" // retenue de garantie jamais versée sur une mission terminée
  | "gig_residual"; // fonds restés au séquestre d'une commande Gig terminée

export type Anomaly = {
  id: string;
  kind: AnomalyKind;
  severity: Severity;
  contractId: string | null;
  orderId: string | null;
  missionId: string | null;
  title: string;
  detail: string;
  amount: number;
  since: string | null;
};

export type PartyRef = { id: string; name: string; email: string | null };

export type ContractFinanceRow = {
  contractId: string;
  missionId: string;
  titre: string;
  missionStatus: string;
  currency: string;
  financingModeKey: string | null;
  isTimeContract: boolean;
  retentionRate: number;
  client: PartyRef;
  provider: PartyRef;
  balance: EscrowBalance;
  financialState: EscrowFinancialState;
  /** Reconnu dû au-delà de ce que le séquestre couvre. */
  missing: number;
  pendingOperations: number;
  lastMovementAt: string | null;
  hasOpenMediation: boolean;
  hasDisputedAttendance: boolean;
  violations: InvariantViolation[];
};

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warning: 1, info: 2 };

export function sortAnomalies(list: Anomaly[]): Anomaly[] {
  return [...list].sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.amount - a.amount);
}

// ── Anomalies d'un contrat — PUR ─────────────────────────────────────────────────────────────
export function contractAnomalies(
  row: Pick<
    ContractFinanceRow,
    "contractId" | "missionId" | "titre" | "missionStatus" | "balance" | "missing" | "hasOpenMediation" | "hasDisputedAttendance" | "violations"
  >
): Anomaly[] {
  const base = { contractId: row.contractId, orderId: null, missionId: row.missionId, title: row.titre, since: null };
  const out: Anomaly[] = [];
  const termine = TERMINAL_MISSION_STATUSES.includes(row.missionStatus);

  if (row.violations.length > 0) {
    out.push({
      ...base,
      id: `invariant_violation:${row.contractId}`,
      kind: "invariant_violation",
      severity: "critical",
      amount: 0,
      detail: row.violations.map((v) => v.detail).join(" · "),
    });
  }
  if (row.missing > EPSILON) {
    out.push({
      ...base,
      id: `unfunded_payable:${row.contractId}`,
      kind: "unfunded_payable",
      severity: "warning",
      amount: row.missing,
      detail: "Travail validé que le séquestre ne couvre pas : le versement attend une recharge du client.",
    });
  }
  if (termine && row.balance.available > EPSILON) {
    out.push({
      ...base,
      id: `residual_on_closed:${row.contractId}`,
      kind: "residual_on_closed",
      severity: "warning",
      amount: row.balance.available,
      detail: "Mission terminée, fonds encore disponibles au séquestre : ils reviennent au client.",
    });
  }
  // Un gel se justifie par une médiation ouverte ou un relevé contesté. Sans l'un ni l'autre, plus
  // rien ne viendra le lever — les fonds sont immobilisés pour personne.
  if (row.balance.blocked > EPSILON && !row.hasOpenMediation && !row.hasDisputedAttendance) {
    out.push({
      ...base,
      id: `orphan_freeze:${row.contractId}`,
      kind: "orphan_freeze",
      severity: "warning",
      amount: row.balance.blocked,
      detail: "Fonds gelés sans médiation ouverte ni relevé contesté : aucun arbitrage ne viendra les lever.",
    });
  }
  if (termine && row.balance.retained > EPSILON) {
    out.push({
      ...base,
      id: `retention_stuck:${row.contractId}`,
      kind: "retention_stuck",
      severity: "warning",
      amount: row.balance.retained,
      detail: "Retenue de garantie acquise au prestataire mais jamais versée.",
    });
  }
  return out;
}

// ── Instructions sans confirmation — PUR ─────────────────────────────────────────────────────
// Un financement non confirmé est une information (le client n'a pas autorisé son paiement) ; un
// versement ou un remboursement non confirmé est un incident : l'argent est parti du registre et
// n'est arrivé nulle part.
export function staleInstructionAnomalies(
  ops: {
    id: string;
    instructionType: string;
    amount: number;
    instructionSentAt: Date;
    contractId: string | null;
    orderId: string | null;
    missionId: string | null;
    title: string;
  }[],
  now: Date
): Anomaly[] {
  return ops
    .filter((op) => now.getTime() - op.instructionSentAt.getTime() >= STALE_INSTRUCTION_HOURS * HOUR_MS)
    .map((op) => {
      const heures = Math.floor((now.getTime() - op.instructionSentAt.getTime()) / HOUR_MS);
      const severity: Severity =
        op.instructionType === "hold" ? "info" : op.instructionType === "freeze" || op.instructionType === "unfreeze" ? "warning" : "critical";
      return {
        id: `stale_instruction:${op.id}`,
        kind: "stale_instruction" as const,
        severity,
        contractId: op.contractId,
        orderId: op.orderId,
        missionId: op.missionId,
        title: op.title,
        amount: op.amount,
        since: op.instructionSentAt.toISOString(),
        detail: `${INSTRUCTION_LABEL[op.instructionType] ?? op.instructionType} en attente de confirmation PSP depuis ${heures} h.`,
      };
    });
}

export const INSTRUCTION_LABEL: Record<string, string> = {
  hold: "Financement",
  release: "Versement au prestataire",
  retention_release: "Versement de la retenue",
  refund: "Remboursement au client",
  freeze: "Gel",
  unfreeze: "Dégel",
};

const PARTY_SELECT = { id: true, firstname: true, lastname: true, email: true } as const;

function partyOf(u: { id: string; firstname: string | null; lastname: string | null; email: string | null }): PartyRef {
  const name = [u.firstname, u.lastname].filter(Boolean).join(" ").trim();
  return { id: u.id, name: name || u.email || "—", email: u.email };
}

// ── Lignes financières des contrats ──────────────────────────────────────────────────────────
// Un nombre CONSTANT de requêtes, quel que soit le nombre de contrats : `escrowBalancesFor` pour
// les soldes, puis trois agrégats. Par défaut, seuls les contrats ayant au moins un mouvement.
export async function loadContractFinanceRows(
  where: Prisma.PrestationContractWhereInput = { escrowOperations: { some: {} } }
): Promise<ContractFinanceRow[]> {
  const contracts = await prisma.prestationContract.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      missionId: true,
      retentionRate: true,
      spotTimeTerms: { select: { id: true } },
      client: { select: PARTY_SELECT },
      provider: { select: PARTY_SELECT },
      mission: { select: { titre: true, status: true, currency: true, financingModeKey: true } },
      mediations: { where: { outcome: "en_cours" }, select: { id: true } },
      attendances: { where: { status: "disputed" }, select: { id: true } },
    },
  });
  if (contracts.length === 0) return [];

  const ids = contracts.map((c) => c.id);
  const [balances, payables, pending, last] = await Promise.all([
    escrowBalancesFor(ids),
    prisma.payable.findMany({
      where: { contractId: { in: ids } },
      select: { id: true, contractId: true, amount: true, status: true, escrowOperationId: true },
    }),
    prisma.pspEscrowOperation.groupBy({
      by: ["contractId"],
      where: { contractId: { in: ids }, status: "pending" },
      _count: { _all: true },
    }),
    prisma.pspEscrowOperation.groupBy({
      by: ["contractId"],
      where: { contractId: { in: ids } },
      _max: { instructionSentAt: true },
    }),
  ]);

  const payablesByContract = new Map<string, typeof payables>();
  for (const p of payables) {
    if (!p.contractId) continue;
    const liste = payablesByContract.get(p.contractId) ?? [];
    liste.push(p);
    payablesByContract.set(p.contractId, liste);
  }
  const pendingByContract = new Map(pending.map((p) => [p.contractId, p._count._all]));
  const lastByContract = new Map(last.map((l) => [l.contractId, l._max.instructionSentAt]));

  return contracts.map((c) => {
    const balance = balances.get(c.id)!;
    return {
      contractId: c.id,
      missionId: c.missionId,
      titre: c.mission.titre,
      missionStatus: c.mission.status,
      currency: c.mission.currency,
      financingModeKey: c.mission.financingModeKey,
      isTimeContract: !!c.spotTimeTerms,
      retentionRate: c.retentionRate,
      client: partyOf(c.client),
      provider: partyOf(c.provider),
      balance,
      financialState: escrowFinancialState(balance, c.mission.status),
      missing: Math.max(0, balance.releasable - balance.available),
      pendingOperations: pendingByContract.get(c.id) ?? 0,
      lastMovementAt: lastByContract.get(c.id)?.toISOString() ?? null,
      hasOpenMediation: c.mediations.length > 0,
      hasDisputedAttendance: c.attendances.length > 0,
      violations: checkBalanceInvariants(balance, payablesByContract.get(c.id) ?? []),
    };
  });
}

type Flow = { funded: number; released: number; refunded: number; held: number };

export type FinanceSnapshot = {
  generatedAt: string;
  missions: Flow & {
    contracts: number;
    blocked: number;
    retained: number;
    owedToProvider: number;
    refundable: number;
    missing: number;
  };
  gigs: Flow & { orders: number };
  total: Flow;
  /** financé = versé + remboursé + détenu, sur tout le registre. */
  identity: { ok: boolean; gap: number };
  pending: { count: number; amount: number; byType: Record<string, { count: number; amount: number }> };
  failedLast30Days: { count: number; amount: number };
  payables: Record<string, { count: number; amount: number }>;
  anomalies: Anomaly[];
  rows: ContractFinanceRow[];
};

export async function loadFinanceSnapshot(now: Date = new Date()): Promise<FinanceSnapshot> {
  const staleBefore = new Date(now.getTime() - STALE_INSTRUCTION_HOURS * HOUR_MS);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * HOUR_MS);

  const [rows, pendingByType, failedAgg, payableAgg, staleOps, failedPayables, gigRows] = await Promise.all([
    loadContractFinanceRows(),
    prisma.pspEscrowOperation.groupBy({
      by: ["instructionType"],
      where: { status: "pending" },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.pspEscrowOperation.aggregate({
      where: { status: "failed", instructionSentAt: { gte: thirtyDaysAgo } },
      _count: { _all: true },
      _sum: { amount: true },
    }),
    prisma.payable.groupBy({ by: ["status"], _count: { _all: true }, _sum: { amount: true } }),
    prisma.pspEscrowOperation.findMany({
      where: { status: "pending", instructionSentAt: { lt: staleBefore } },
      orderBy: { instructionSentAt: "asc" },
      take: 200,
      select: {
        id: true,
        instructionType: true,
        amount: true,
        instructionSentAt: true,
        contractId: true,
        orderId: true,
        contract: { select: { missionId: true, mission: { select: { titre: true } } } },
      },
    }),
    prisma.payable.findMany({
      where: { status: "failed" },
      orderBy: { validatedAt: "asc" },
      take: 200,
      select: {
        id: true,
        amount: true,
        validatedAt: true,
        contractId: true,
        missionId: true,
        contract: { select: { mission: { select: { titre: true } } } },
      },
    }),
    prisma.pspEscrowOperation.groupBy({
      by: ["orderId", "instructionType", "status"],
      where: { sourceType: "gig_order", status: { in: IN_FLIGHT_STATUSES } },
      _sum: { amount: true },
    }),
  ]);

  // ── Missions ──
  const sumRows = (pick: (b: EscrowBalance) => number) => rows.reduce((s, r) => s + pick(r.balance), 0);
  const missions = {
    contracts: rows.length,
    funded: sumRows((b) => b.funded),
    released: sumRows((b) => b.released),
    refunded: sumRows((b) => b.refunded),
    held: sumRows((b) => b.held),
    blocked: sumRows((b) => b.blocked),
    retained: sumRows((b) => b.retained),
    owedToProvider: sumRows((b) => b.owedToProvider),
    refundable: sumRows((b) => b.refundable),
    missing: rows.reduce((s, r) => s + r.missing, 0),
  };

  // ── Commandes Gig : même règle de solde, sans jalon ni retenue ──
  const parCommande = new Map<string, { instructionType: string; status: string; amount: number }[]>();
  for (const r of gigRows) {
    if (!r.orderId) continue;
    const liste = parCommande.get(r.orderId) ?? [];
    liste.push({ instructionType: r.instructionType, status: r.status, amount: r._sum.amount ?? 0 });
    parCommande.set(r.orderId, liste);
  }
  const orderIds = [...parCommande.keys()];
  const orders = orderIds.length
    ? await prisma.gigOrder.findMany({ where: { id: { in: orderIds } }, select: { id: true, status: true } })
    : [];
  const statutCommande = new Map(orders.map((o) => [o.id, o.status]));

  const gigs = { orders: orderIds.length, funded: 0, released: 0, refunded: 0, held: 0 };
  const gigAnomalies: Anomaly[] = [];
  for (const [orderId, flat] of parCommande) {
    const sum = (type: string) => flat.filter((r) => r.instructionType === type).reduce((s, r) => s + r.amount, 0);
    const funded = flat.filter((r) => r.instructionType === "hold" && r.status === "confirmed").reduce((s, r) => s + r.amount, 0);
    const held = netHeldAmount(flat);
    gigs.funded += funded;
    gigs.released += sum("release") + sum("retention_release");
    gigs.refunded += sum("refund");
    gigs.held += held;
    const statut = statutCommande.get(orderId);
    if (statut && TERMINAL_GIG_STATUSES.includes(statut) && held > EPSILON) {
      gigAnomalies.push({
        id: `gig_residual:${orderId}`,
        kind: "gig_residual",
        severity: "warning",
        contractId: null,
        orderId,
        missionId: null,
        title: `Commande Gig #${orderId.slice(0, 8)}`,
        amount: held,
        since: null,
        detail: `Commande « ${statut} » dont le séquestre n'est pas soldé.`,
      });
    }
  }

  const total: Flow = {
    funded: missions.funded + gigs.funded,
    released: missions.released + gigs.released,
    refunded: missions.refunded + gigs.refunded,
    held: missions.held + gigs.held,
  };
  const gap = total.funded - (total.released + total.refunded + total.held);

  const byType: Record<string, { count: number; amount: number }> = {};
  for (const g of pendingByType) byType[g.instructionType] = { count: g._count._all, amount: g._sum.amount ?? 0 };

  const payables: Record<string, { count: number; amount: number }> = {};
  for (const g of payableAgg) payables[g.status] = { count: g._count._all, amount: g._sum.amount ?? 0 };

  const anomalies = sortAnomalies([
    ...rows.flatMap((r) => contractAnomalies(r)),
    ...staleInstructionAnomalies(
      staleOps.map((op) => ({
        id: op.id,
        instructionType: op.instructionType,
        amount: op.amount,
        instructionSentAt: op.instructionSentAt,
        contractId: op.contractId,
        orderId: op.orderId,
        missionId: op.contract?.missionId ?? null,
        title: op.contract?.mission.titre ?? (op.orderId ? `Commande Gig #${op.orderId.slice(0, 8)}` : "Opération"),
      })),
      now
    ),
    ...failedPayables.map((p) => ({
      id: `failed_payout:${p.id}`,
      kind: "failed_payout" as const,
      severity: "critical" as const,
      contractId: p.contractId,
      orderId: null,
      missionId: p.missionId,
      title: p.contract?.mission.titre ?? "Créance",
      amount: p.amount,
      since: p.validatedAt.toISOString(),
      detail: "Versement refusé par le PSP : la créance reste due et doit être réinstruite.",
    })),
    ...gigAnomalies,
  ]);

  return {
    generatedAt: now.toISOString(),
    missions,
    gigs,
    total,
    identity: { ok: Math.abs(gap) <= EPSILON, gap },
    pending: {
      count: pendingByType.reduce((s, g) => s + g._count._all, 0),
      amount: pendingByType.reduce((s, g) => s + (g._sum.amount ?? 0), 0),
      byType,
    },
    failedLast30Days: { count: failedAgg._count._all, amount: failedAgg._sum.amount ?? 0 },
    payables,
    anomalies,
    rows,
  };
}

// ── Registre des opérations ──────────────────────────────────────────────────────────────────
const INSTRUCTION_TYPES: readonly EscrowInstructionType[] = ["hold", "release", "retention_release", "refund", "freeze", "unfreeze"];
const OPERATION_STATUSES: readonly PspOperationStatus[] = ["pending", "confirmed", "failed"];
const SOURCE_TYPES: readonly EscrowSourceType[] = ["mission_contract", "gig_order"];
const PAYABLE_STATUSES: readonly PayableStatus[] = ["validated", "instructed", "paid", "failed"];

export type OperationRow = {
  id: string;
  sourceType: string;
  instructionType: string;
  status: string;
  amount: number;
  currency: string;
  pspName: string;
  pspReference: string | null;
  instructionSentAt: string;
  pspConfirmedAt: string | null;
  contractId: string | null;
  orderId: string | null;
  missionId: string | null;
  label: string;
  jalon: string | null;
  payableStatus: string | null;
};

const OPERATION_SELECT = {
  id: true,
  sourceType: true,
  instructionType: true,
  status: true,
  amount: true,
  currency: true,
  pspName: true,
  pspReference: true,
  instructionSentAt: true,
  pspConfirmedAt: true,
  contractId: true,
  orderId: true,
  contract: { select: { missionId: true, mission: { select: { titre: true } } } },
  jalon: { select: { ordre: true, titre: true } },
  payable: { select: { status: true } },
} satisfies Prisma.PspEscrowOperationSelect;

function toOperationRow(op: Prisma.PspEscrowOperationGetPayload<{ select: typeof OPERATION_SELECT }>): OperationRow {
  return {
    id: op.id,
    sourceType: op.sourceType,
    instructionType: op.instructionType,
    status: op.status,
    amount: op.amount,
    currency: op.currency,
    pspName: op.pspName,
    pspReference: op.pspReference,
    instructionSentAt: op.instructionSentAt.toISOString(),
    pspConfirmedAt: op.pspConfirmedAt?.toISOString() ?? null,
    contractId: op.contractId,
    orderId: op.orderId,
    missionId: op.contract?.missionId ?? null,
    label: op.contract?.mission.titre ?? (op.orderId ? `Commande Gig #${op.orderId.slice(0, 8)}` : "—"),
    jalon: op.jalon ? `Jalon ${op.jalon.ordre} — ${op.jalon.titre}` : null,
    payableStatus: op.payable?.status ?? null,
  };
}

function pick<T extends string>(allowed: readonly T[], value: string | null | undefined): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

export async function listOperations(filters: {
  type?: string | null;
  status?: string | null;
  source?: string | null;
  q?: string | null;
  cursor?: string | null;
  limit?: number;
}): Promise<{ items: OperationRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const q = filters.q?.trim();
  const where: Prisma.PspEscrowOperationWhereInput = {
    instructionType: pick(INSTRUCTION_TYPES, filters.type),
    status: pick(OPERATION_STATUSES, filters.status),
    sourceType: pick(SOURCE_TYPES, filters.source),
    ...(q
      ? {
          OR: [
            { pspReference: { contains: q, mode: "insensitive" } },
            { id: q },
            { contractId: q },
            { orderId: q },
            { contract: { missionId: q } },
            { contract: { mission: { titre: { contains: q, mode: "insensitive" } } } },
          ],
        }
      : {}),
  };

  const ops = await prisma.pspEscrowOperation.findMany({
    where,
    orderBy: [{ instructionSentAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    select: OPERATION_SELECT,
  });
  const page = ops.slice(0, limit);
  return { items: page.map(toOperationRow), nextCursor: ops.length > limit ? page[page.length - 1].id : null };
}

// ── Créances ─────────────────────────────────────────────────────────────────────────────────
export type PayableAdminRow = {
  id: string;
  label: string;
  sourceType: string;
  amount: number;
  currency: string;
  status: string;
  validatedAt: string;
  paidAt: string | null;
  contractId: string | null;
  missionId: string | null;
  missionTitle: string;
  reference: string | null;
};

export async function listPayables(filters: {
  status?: string | null;
  q?: string | null;
  cursor?: string | null;
  limit?: number;
}): Promise<{ items: PayableAdminRow[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const q = filters.q?.trim();
  const payables = await prisma.payable.findMany({
    where: {
      status: pick(PAYABLE_STATUSES, filters.status),
      ...(q
        ? {
            OR: [
              { id: q },
              { contractId: q },
              { missionId: q },
              { contract: { mission: { titre: { contains: q, mode: "insensitive" } } } },
            ],
          }
        : {}),
    },
    orderBy: [{ validatedAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      sourceType: true,
      sourceId: true,
      amount: true,
      currency: true,
      status: true,
      validatedAt: true,
      paidAt: true,
      contractId: true,
      missionId: true,
      contract: { select: { missionId: true, mission: { select: { titre: true } } } },
      escrowOperation: { select: { pspReference: true } },
    },
  });
  const page = payables.slice(0, limit);
  const label = await buildPayableLabeler(page);
  return {
    items: page.map((p) => {
      const missionTitle = p.contract?.mission.titre ?? "—";
      return {
        id: p.id,
        label: label(p, missionTitle),
        sourceType: p.sourceType,
        amount: p.amount,
        currency: p.currency,
        status: p.status,
        validatedAt: p.validatedAt.toISOString(),
        paidAt: p.paidAt?.toISOString() ?? null,
        contractId: p.contractId,
        missionId: p.missionId ?? p.contract?.missionId ?? null,
        missionTitle,
        reference: p.escrowOperation?.pspReference ?? null,
      };
    }),
    nextCursor: payables.length > limit ? page[page.length - 1].id : null,
  };
}

// ── Fiche d'un contrat ───────────────────────────────────────────────────────────────────────
export type ContractFinanceDetail = {
  row: ContractFinanceRow;
  price: number;
  financingMode: string;
  fundingGranularity: string;
  timeTerms: { rateUnit: string; rate: number; maxQuantity: number; maxAmount: number } | null;
  signedAt: { client: string | null; provider: string | null };
  jalons: { ordre: number; titre: string; montant: number; status: string }[];
  mediations: {
    id: string;
    outcome: string;
    reason: string;
    resolutionAmount: number | null;
    refundAmount: number | null;
    createdAt: string;
    closedAt: string | null;
  }[];
  attendance: Record<string, number>;
  operations: OperationRow[];
  payables: PayableAdminRow[];
  adminLogs: { id: string; createdAt: string; adminEmail: string | null; action: string; justification: string }[];
  anomalies: Anomaly[];
  actions: {
    refund: { available: boolean; amount: number };
    retention: { available: boolean; amount: number; reason: string | null };
  };
};

export async function loadContractFinanceDetail(contractId: string, now: Date = new Date()): Promise<ContractFinanceDetail | null> {
  const [row] = await loadContractFinanceRows({ id: contractId });
  if (!row) return null;

  const [contract, operations, payablesPage, attendance, adminLogs, balance] = await Promise.all([
    prisma.prestationContract.findUniqueOrThrow({
      where: { id: contractId },
      select: {
        termsSnapshot: true,
        financingMode: true,
        fundingGranularity: true,
        clientSignedAt: true,
        providerSignedAt: true,
        spotTimeTerms: { select: { rateUnit: true, rate: true, maxQuantity: true, maxAmount: true } },
        jalons: { orderBy: { ordre: "asc" }, select: { ordre: true, titre: true, montant: true, status: true } },
        mediations: {
          orderBy: { createdAt: "desc" },
          select: { id: true, outcome: true, reason: true, resolutionAmount: true, refundAmount: true, createdAt: true, closedAt: true },
        },
        mission: { select: { budget: true } },
      },
    }),
    prisma.pspEscrowOperation.findMany({
      where: { contractId },
      orderBy: [{ instructionSentAt: "desc" }, { id: "desc" }],
      select: OPERATION_SELECT,
    }),
    listPayables({ q: contractId, limit: 200 }),
    prisma.attendance.groupBy({ by: ["status"], where: { contractId }, _count: { _all: true } }),
    prisma.adminAuditLog.findMany({
      where: { targetType: "PrestationContract", targetId: contractId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: { id: true, createdAt: true, action: true, justification: true, admin: { select: { email: true } } },
    }),
    escrowBalance(contractId),
  ]);

  const opRows = operations.map(toOperationRow);
  const stale = staleInstructionAnomalies(
    operations
      .filter((op) => op.status === "pending")
      .map((op) => ({
        id: op.id,
        instructionType: op.instructionType,
        amount: op.amount,
        instructionSentAt: op.instructionSentAt,
        contractId,
        orderId: null,
        missionId: row.missionId,
        title: row.titre,
      })),
    now
  );
  const failed = payablesPage.items
    .filter((p) => p.status === "failed")
    .map((p) => ({
      id: `failed_payout:${p.id}`,
      kind: "failed_payout" as const,
      severity: "critical" as const,
      contractId,
      orderId: null,
      missionId: row.missionId,
      title: p.label,
      amount: p.amount,
      since: p.validatedAt,
      detail: "Versement refusé par le PSP : la créance reste due et doit être réinstruite.",
    }));

  // Retenue : seule celle des jalons LIBÉRÉS est acquise, et une instruction en vol interdit d'en
  // émettre une seconde — mêmes conditions que la route de solde, lues ici pour ne proposer que
  // des gestes qui aboutiront.
  const accrued = totalRetentionAmount(contract.jalons.filter((j) => j.status === "libere"), row.retentionRate);
  const retentionInFlight = operations.some(
    (op) => op.instructionType === "retention_release" && (IN_FLIGHT_STATUSES as string[]).includes(op.status)
  );
  const retentionReason =
    row.retentionRate <= 0
      ? "Ce contrat ne porte pas de retenue de garantie."
      : accrued <= 0
        ? "Aucun jalon libéré : aucune retenue n'est encore acquise."
        : retentionInFlight
          ? "La retenue a déjà été instruite."
          : null;

  const snapshot = contract.termsSnapshot as { prix?: number } | null;

  return {
    row,
    price: typeof snapshot?.prix === "number" && snapshot.prix > 0 ? snapshot.prix : contract.mission.budget,
    financingMode: contract.financingMode,
    fundingGranularity: contract.fundingGranularity,
    timeTerms: contract.spotTimeTerms,
    signedAt: {
      client: contract.clientSignedAt?.toISOString() ?? null,
      provider: contract.providerSignedAt?.toISOString() ?? null,
    },
    jalons: contract.jalons,
    mediations: contract.mediations.map((m) => ({
      ...m,
      createdAt: m.createdAt.toISOString(),
      closedAt: m.closedAt?.toISOString() ?? null,
    })),
    attendance: Object.fromEntries(attendance.map((a) => [a.status, a._count._all])),
    operations: opRows,
    payables: payablesPage.items,
    adminLogs: adminLogs.map((l) => ({
      id: l.id,
      createdAt: l.createdAt.toISOString(),
      adminEmail: l.admin.email,
      action: l.action,
      justification: l.justification,
    })),
    anomalies: sortAnomalies([...contractAnomalies(row), ...stale, ...failed]),
    actions: {
      refund: { available: balance.available > EPSILON, amount: balance.available },
      retention: { available: retentionReason === null, amount: Math.max(0, balance.retained), reason: retentionReason },
    },
  };
}
