import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { utcTimestamp } from "@/lib/sql-time";
import { pspAdapter, type PspInstruction } from "@/lib/psp/adapter";
import { queueMode } from "@/lib/queue-mode";

// ---------------------------------------------------------------------------
// Transmission des instructions PSP — boîte d'envoi (outbox), 2026-10-01.
//
// Une instruction est d'abord ÉCRITE (`PspEscrowOperation`, `dispatchStatus = a_envoyer`) dans
// la transaction métier qui la décide, sous le verrou du contrat. Elle est ensuite TRANSMISE ici,
// hors de toute transaction : l'appel au PSP ne prolonge plus jamais la section verrouillée, et
// un PSP lent ou en panne ne fait plus échouer — ni attendre — l'action de l'utilisateur.
//
// Réclamation par bail : `FOR UPDATE SKIP LOCKED` + `dispatchLeaseUntil`. Plusieurs workers (ou
// un worker et une requête web en mode inline) peuvent tourner en parallèle sans jamais
// transmettre deux fois la même ligne ; un transmetteur qui meurt en cours de route libère la
// ligne à l'expiration de son bail. Le PSP déduplique de son côté par `pspReference` : une
// retransmission après un accusé perdu est sans effet.
//
// ⚠️ Horodatages : via `utcTimestamp`, jamais `now()` SQL ni un `Date` brut — voir sql-time.ts.
// ---------------------------------------------------------------------------

export const MAX_DISPATCH_ATTEMPTS = 8;
const LEASE_MS = 60_000;

/** Attente avant la tentative n° `attempt + 1` : 10 s, 20 s, 40 s… plafonnée à 30 min. */
export function dispatchBackoffMs(attempt: number): number {
  return Math.min(10_000 * 2 ** Math.max(0, attempt - 1), 30 * 60_000);
}

type ClaimedRow = PspInstruction & { dispatchAttempts: number };

async function claim(filter: { id: string } | { limit: number }): Promise<ClaimedRow[]> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const byId = "id" in filter ? Prisma.sql`AND id = ${filter.id}` : Prisma.empty;
  const limit = "id" in filter ? 1 : filter.limit;
  return prisma.$queryRaw<ClaimedRow[]>`
    UPDATE "PspEscrowOperation"
       SET "dispatchStatus" = 'en_cours',
           "dispatchLeaseUntil" = ${utcTimestamp(leaseUntil)},
           "dispatchAttempts" = "dispatchAttempts" + 1
     WHERE id IN (
       SELECT id FROM "PspEscrowOperation"
        WHERE "sourceType" = 'mission_contract'
          AND status = 'pending'
          AND "pspReference" IS NOT NULL
          AND (("dispatchStatus" = 'a_envoyer' AND "nextDispatchAt" <= ${utcTimestamp(now)})
            OR ("dispatchStatus" = 'en_cours' AND "dispatchLeaseUntil" < ${utcTimestamp(now)}))
          ${byId}
        ORDER BY "nextDispatchAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, "pspReference", "instructionType"::text AS "instructionType", amount, currency,
              "contractId", "jalonId", "dispatchAttempts"`;
}

export type DispatchOutcome = "sent" | "retry_scheduled" | "abandoned" | "not_claimed";

async function send(row: ClaimedRow): Promise<DispatchOutcome> {
  try {
    await pspAdapter().sendInstruction(row);
    await prisma.pspEscrowOperation.update({
      where: { id: row.id },
      data: { dispatchStatus: "envoyee", dispatchedAt: new Date(), dispatchLeaseUntil: null, lastDispatchError: null },
    });
    return "sent";
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const abandoned = row.dispatchAttempts >= MAX_DISPATCH_ATTEMPTS;
    await prisma.pspEscrowOperation.update({
      where: { id: row.id },
      data: {
        dispatchStatus: abandoned ? "echec_envoi" : "a_envoyer",
        dispatchLeaseUntil: null,
        lastDispatchError: message,
        nextDispatchAt: new Date(Date.now() + dispatchBackoffMs(row.dispatchAttempts)),
      },
    });
    console.error(`[psp-dispatch] ${row.pspReference} tentative ${row.dispatchAttempts} : ${message}`);
    return abandoned ? "abandoned" : "retry_scheduled";
  }
}

/** Transmet UNE instruction si elle est à envoyer et que personne d'autre ne la détient. */
export async function dispatchOperation(operationId: string): Promise<DispatchOutcome> {
  const [row] = await claim({ id: operationId });
  if (!row) return "not_claimed";
  return send(row);
}

/** Tour de worker : réclame un lot d'instructions dues et les transmet. */
export async function dispatchDueOperations(limit = 50): Promise<Record<DispatchOutcome, number>> {
  const rows = await claim({ limit });
  const counts: Record<DispatchOutcome, number> = { sent: 0, retry_scheduled: 0, abandoned: 0, not_claimed: 0 };
  // En séquence, volontairement : en autoconfirm, chaque transmission rejoue un webhook qui prend
  // le verrou du contrat — les paralléliser ne ferait que les mettre en file sur ce verrou.
  for (const row of rows) counts[await send(row)]++;
  return counts;
}

/**
 * À appeler APRÈS la validation de la transaction qui a créé l'instruction (jamais dedans : en
 * autoconfirm, la transmission rejoue un webhook qui attend le verrou que la transaction détient).
 *
 * Mode `worker` : rien à faire, le worker la prendra — sauf un HOLD, que le client attend.
 * Mode `inline` : transmission immédiate, comme avant l'outbox.
 */
export async function afterInstructionCommitted(operation: { id: string; instructionType: string }): Promise<void> {
  if (queueMode() === "worker" && operation.instructionType !== "hold") return;
  await dispatchOperation(operation.id);
}
