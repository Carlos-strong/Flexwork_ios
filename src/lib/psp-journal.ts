import type { EscrowInstructionType, Prisma, PspEventChannel, PspEventOutcome } from "@prisma/client";
import { prisma } from "@/lib/db";

// Journal des échanges plateforme ⇄ PSP (2026-09-15) — lecture pour la console admin.
//
// Un échange a deux sens, lus à deux endroits :
//   - SORTANT (plateforme → PSP) : l'instruction transmise — c'est la ligne `PspEscrowOperation`
//     elle-même, horodatée à sa transmission. La dupliquer dans une table de logs créerait deux
//     vérités sur le même envoi ;
//   - ENTRANT (PSP → plateforme) : chaque message reçu, consigné par `recordPspEvent`
//     (src/lib/psp-webhook.ts) avec son issue — y compris ceux qui ne correspondent à rien.
//
// Les deux sont entrelacés chronologiquement, avec une pagination par curseur commune.

const HOUR_MS = 60 * 60 * 1000;
export const UNANSWERED_AFTER_HOURS = 24;

export type JournalPeriod = "24h" | "7d" | "30d" | "all";
const PERIOD_MS: Record<Exclude<JournalPeriod, "all">, number> = { "24h": 24 * HOUR_MS, "7d": 7 * 24 * HOUR_MS, "30d": 30 * 24 * HOUR_MS };

export function periodStart(period: string | null | undefined, now: Date): Date | null {
  return period && period in PERIOD_MS ? new Date(now.getTime() - PERIOD_MS[period as keyof typeof PERIOD_MS]) : null;
}

export type JournalOutbound = {
  kind: "outbound";
  key: string;
  at: string;
  operationId: string;
  pspReference: string | null;
  pspName: string;
  instructionType: string;
  amount: number;
  currency: string;
  operationStatus: string;
  confirmedAt: string | null;
  /** Délai entre la transmission et la confirmation (ou l'échec) enregistrée. */
  latencyMs: number | null;
  contractId: string | null;
  orderId: string | null;
  missionId: string | null;
  label: string;
};

export type JournalInbound = {
  kind: "inbound";
  key: string;
  at: string;
  logId: string;
  channel: string;
  event: string;
  outcome: string;
  error: string | null;
  signatureValid: boolean;
  durationMs: number;
  pspReference: string | null;
  operationId: string | null;
  instructionType: string | null;
  amount: number | null;
  contractId: string | null;
  orderId: string | null;
  missionId: string | null;
  label: string;
  /** Délai entre la transmission de l'instruction et la réception de ce message. */
  latencyMs: number | null;
};

export type JournalItem = JournalOutbound | JournalInbound;

export type JournalFilters = {
  direction?: string | null;
  outcome?: string | null;
  channel?: string | null;
  error?: string | null;
  type?: string | null;
  q?: string | null;
  period?: string | null;
  cursor?: string | null;
  limit?: number | null;
};

const OUTCOMES: readonly PspEventOutcome[] = ["applied", "replayed", "rejected"];
const CHANNELS: readonly PspEventChannel[] = ["webhook", "virtual_console", "autoconfirm"];
const TYPES: readonly EscrowInstructionType[] = ["hold", "release", "retention_release", "refund", "freeze", "unfreeze"];

function pick<T extends string>(allowed: readonly T[], value: string | null | undefined): T | undefined {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : undefined;
}

// Curseur `<iso>|<sens>:<id>` : l'ordre de tri est (horodatage desc, clé desc), et la clé départage
// deux messages de la même milliseconde, y compris entre les deux sources.
function parseCursor(cursor: string | null | undefined): { at: Date; prefix: string; id: string } | null {
  if (!cursor) return null;
  const [iso, key] = cursor.split("|");
  const [prefix, id] = (key ?? "").split(":");
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) || !prefix || !id ? null : { at, prefix, id };
}

function compareDesc(a: JournalItem, b: JournalItem): number {
  return b.at.localeCompare(a.at) || (b.key < a.key ? -1 : b.key > a.key ? 1 : 0);
}

export async function listPspJournal(
  filters: JournalFilters,
  now: Date = new Date()
): Promise<{ items: JournalItem[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const since = periodStart(filters.period, now);
  const cur = parseCursor(filters.cursor);
  const q = filters.q?.trim();
  const type = pick(TYPES, filters.type);
  const outcome = pick(OUTCOMES, filters.outcome);
  const channel = pick(CHANNELS, filters.channel);
  const error = filters.error?.trim() || undefined;

  // Un filtre qui ne concerne que les messages reçus (issue, canal, motif) exclut les instructions.
  const inboundOnly = !!(outcome || channel || error);
  const wantOut = filters.direction !== "inbound" && !inboundOnly;
  const wantIn = filters.direction !== "outbound";

  // Portion « avant le curseur » pour une source donnée — voir compareDesc pour l'ordre.
  const beforeCursor = (prefix: "in" | "out") => {
    if (!cur) return null;
    const sameInstant = prefix === cur.prefix ? { id: { lt: cur.id } } : prefix < cur.prefix ? {} : null;
    return { at: cur.at, sameInstant };
  };

  const [ops, logs] = await Promise.all([
    wantOut
      ? prisma.pspEscrowOperation.findMany({
          where: {
            AND: [
              since ? { instructionSentAt: { gte: since } } : {},
              type ? { instructionType: type } : {},
              q
                ? { OR: [{ pspReference: { contains: q, mode: "insensitive" } }, { id: q }, { contractId: q }, { orderId: q }] }
                : {},
              (() => {
                const b = beforeCursor("out");
                if (!b) return {};
                return {
                  OR: [
                    { instructionSentAt: { lt: b.at } },
                    ...(b.sameInstant ? [{ instructionSentAt: b.at, ...b.sameInstant }] : []),
                  ],
                } satisfies Prisma.PspEscrowOperationWhereInput;
              })(),
            ],
          },
          orderBy: [{ instructionSentAt: "desc" }, { id: "desc" }],
          take: limit + 1,
          select: {
            id: true,
            pspReference: true,
            pspName: true,
            instructionType: true,
            amount: true,
            currency: true,
            status: true,
            instructionSentAt: true,
            pspConfirmedAt: true,
            contractId: true,
            orderId: true,
            contract: { select: { missionId: true, mission: { select: { titre: true } } } },
          },
        })
      : [],
    wantIn
      ? prisma.pspEventLog.findMany({
          where: {
            AND: [
              since ? { receivedAt: { gte: since } } : {},
              type ? { instructionType: type } : {},
              outcome ? { outcome } : {},
              channel ? { channel } : {},
              error ? { error } : {},
              q
                ? { OR: [{ pspReference: { contains: q, mode: "insensitive" } }, { operationId: q }, { contractId: q }, { orderId: q }] }
                : {},
              (() => {
                const b = beforeCursor("in");
                if (!b) return {};
                return {
                  OR: [{ receivedAt: { lt: b.at } }, ...(b.sameInstant ? [{ receivedAt: b.at, ...b.sameInstant }] : [])],
                } satisfies Prisma.PspEventLogWhereInput;
              })(),
            ],
          },
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          take: limit + 1,
        })
      : [],
  ]);

  // Contexte des messages reçus : l'instruction qu'ils concernent (délai, mission).
  const linkedIds = [...new Set(logs.map((l) => l.operationId).filter((id): id is string => !!id))];
  const linked = linkedIds.length
    ? await prisma.pspEscrowOperation.findMany({
        where: { id: { in: linkedIds } },
        select: { id: true, instructionSentAt: true, contract: { select: { missionId: true, mission: { select: { titre: true } } } } },
      })
    : [];
  const linkedById = new Map(linked.map((o) => [o.id, o]));

  const label = (mission: string | undefined, orderId: string | null) =>
    mission ?? (orderId ? `Commande Gig #${orderId.slice(0, 8)}` : "—");

  const items: JournalItem[] = [
    ...ops.map(
      (op): JournalOutbound => ({
        kind: "outbound",
        key: `out:${op.id}`,
        at: op.instructionSentAt.toISOString(),
        operationId: op.id,
        pspReference: op.pspReference,
        pspName: op.pspName,
        instructionType: op.instructionType,
        amount: op.amount,
        currency: op.currency,
        operationStatus: op.status,
        confirmedAt: op.pspConfirmedAt?.toISOString() ?? null,
        latencyMs: op.pspConfirmedAt ? op.pspConfirmedAt.getTime() - op.instructionSentAt.getTime() : null,
        contractId: op.contractId,
        orderId: op.orderId,
        missionId: op.contract?.missionId ?? null,
        label: label(op.contract?.mission.titre, op.orderId),
      })
    ),
    ...logs.map((l): JournalInbound => {
      const op = l.operationId ? linkedById.get(l.operationId) : undefined;
      return {
        kind: "inbound",
        key: `in:${l.id}`,
        at: l.receivedAt.toISOString(),
        logId: l.id,
        channel: l.channel,
        event: l.event,
        outcome: l.outcome,
        error: l.error,
        signatureValid: l.signatureValid,
        durationMs: l.durationMs,
        pspReference: l.pspReference,
        operationId: l.operationId,
        instructionType: l.instructionType,
        amount: l.amount,
        contractId: l.contractId,
        orderId: l.orderId,
        missionId: op?.contract?.missionId ?? null,
        label: label(op?.contract?.mission.titre, l.orderId),
        latencyMs: op ? l.receivedAt.getTime() - op.instructionSentAt.getTime() : null,
      };
    }),
  ].sort(compareDesc);

  const page = items.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page, nextCursor: items.length > limit && last ? `${last.at}|${last.key}` : null };
}

/** Percentile (0–1) d'une série, par rang le plus proche. Null sur une série vide. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[rank];
}

export type JournalStats = {
  period: JournalPeriod;
  outbound: number;
  inbound: { total: number; applied: number; replayed: number; rejected: number };
  byChannel: Record<string, number>;
  rejectionsByError: { error: string; count: number }[];
  /** Instructions toujours sans réponse du PSP après 24 h, toutes périodes confondues. */
  unanswered: number;
  pendingNow: number;
  confirmation: {
    payouts: { count: number; medianMs: number | null; p95Ms: number | null };
    funding: { count: number; medianMs: number | null; p95Ms: number | null };
  };
};

const LATENCY_SAMPLE = 2000;

export async function pspJournalStats(period: string | null | undefined, now: Date = new Date()): Promise<JournalStats> {
  const since = periodStart(period, now);
  const inRange = since ? { receivedAt: { gte: since } } : {};
  const opsRange = since ? { instructionSentAt: { gte: since } } : {};

  const [byOutcome, byChannel, byError, outbound, unanswered, pendingNow, confirmed] = await Promise.all([
    prisma.pspEventLog.groupBy({ by: ["outcome"], where: inRange, _count: { _all: true } }),
    prisma.pspEventLog.groupBy({ by: ["channel"], where: inRange, _count: { _all: true } }),
    prisma.pspEventLog.groupBy({ by: ["error"], where: { ...inRange, outcome: "rejected" }, _count: { _all: true } }),
    prisma.pspEscrowOperation.count({ where: opsRange }),
    prisma.pspEscrowOperation.count({
      where: { status: "pending", instructionSentAt: { lt: new Date(now.getTime() - UNANSWERED_AFTER_HOURS * HOUR_MS) } },
    }),
    prisma.pspEscrowOperation.count({ where: { status: "pending" } }),
    prisma.pspEscrowOperation.findMany({
      where: { pspConfirmedAt: since ? { gte: since } : { not: null } },
      orderBy: { pspConfirmedAt: "desc" },
      take: LATENCY_SAMPLE,
      select: { instructionType: true, instructionSentAt: true, pspConfirmedAt: true },
    }),
  ]);

  const count = (o: string) => byOutcome.find((g) => g.outcome === o)?._count._all ?? 0;
  const delais = (predicate: (t: string) => boolean) =>
    confirmed
      .filter((o) => o.pspConfirmedAt && predicate(o.instructionType))
      .map((o) => o.pspConfirmedAt!.getTime() - o.instructionSentAt.getTime())
      .filter((ms) => ms >= 0);
  // Un financement attend l'autorisation du CLIENT sur son téléphone ; un versement ne dépend que
  // du PSP. Les mélanger noierait la réactivité du PSP dans le temps de réaction des clients.
  const payouts = delais((t) => t !== "hold");
  const funding = delais((t) => t === "hold");

  return {
    period: (since ? period : "all") as JournalPeriod,
    outbound,
    inbound: {
      total: byOutcome.reduce((s, g) => s + g._count._all, 0),
      applied: count("applied"),
      replayed: count("replayed"),
      rejected: count("rejected"),
    },
    byChannel: Object.fromEntries(byChannel.map((g) => [g.channel, g._count._all])),
    rejectionsByError: byError
      .map((g) => ({ error: g.error ?? "unknown", count: g._count._all }))
      .sort((a, b) => b.count - a.count),
    unanswered,
    pendingNow,
    confirmation: {
      payouts: { count: payouts.length, medianMs: percentile(payouts, 0.5), p95Ms: percentile(payouts, 0.95) },
      funding: { count: funding.length, medianMs: percentile(funding, 0.5), p95Ms: percentile(funding, 0.95) },
    },
  };
}

export type PspExchange = {
  reference: string;
  operation: {
    id: string;
    sourceType: string;
    instructionType: string;
    status: string;
    amount: number;
    currency: string;
    pspName: string;
    instructionSentAt: string;
    pspConfirmedAt: string | null;
    webhookReference: string | null;
    contractId: string | null;
    orderId: string | null;
    missionId: string | null;
    label: string;
  } | null;
  events: {
    id: string;
    receivedAt: string;
    channel: string;
    event: string;
    outcome: string;
    error: string | null;
    signatureValid: boolean;
    durationMs: number;
    payload: unknown;
  }[];
};

/** Toute la conversation autour d'une référence PSP : l'instruction, puis chaque message reçu. */
export async function loadPspExchange(reference: string): Promise<PspExchange | null> {
  const [operation, logs] = await Promise.all([
    prisma.pspEscrowOperation.findUnique({
      where: { pspReference: reference },
      select: {
        id: true,
        sourceType: true,
        instructionType: true,
        status: true,
        amount: true,
        currency: true,
        pspName: true,
        instructionSentAt: true,
        pspConfirmedAt: true,
        webhookReference: true,
        contractId: true,
        orderId: true,
        contract: { select: { missionId: true, mission: { select: { titre: true } } } },
      },
    }),
    prisma.pspEventLog.findMany({ where: { pspReference: reference }, orderBy: [{ receivedAt: "asc" }, { id: "asc" }], take: 500 }),
  ]);
  if (!operation && logs.length === 0) return null;

  return {
    reference,
    operation: operation
      ? {
          id: operation.id,
          sourceType: operation.sourceType,
          instructionType: operation.instructionType,
          status: operation.status,
          amount: operation.amount,
          currency: operation.currency,
          pspName: operation.pspName,
          instructionSentAt: operation.instructionSentAt.toISOString(),
          pspConfirmedAt: operation.pspConfirmedAt?.toISOString() ?? null,
          webhookReference: operation.webhookReference,
          contractId: operation.contractId,
          orderId: operation.orderId,
          missionId: operation.contract?.missionId ?? null,
          label: operation.contract?.mission.titre ?? (operation.orderId ? `Commande Gig #${operation.orderId.slice(0, 8)}` : "—"),
        }
      : null,
    events: logs.map((l) => ({
      id: l.id,
      receivedAt: l.receivedAt.toISOString(),
      channel: l.channel,
      event: l.event,
      outcome: l.outcome,
      error: l.error,
      signatureValid: l.signatureValid,
      durationMs: l.durationMs,
      payload: l.payload,
    })),
  };
}
