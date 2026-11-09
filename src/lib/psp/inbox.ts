import { Prisma, type PspInboundEvent } from "@prisma/client";
import { prisma } from "@/lib/db";
import { utcTimestamp } from "@/lib/sql-time";
import { applyPspWebhookEvent, recordPspEvent, type ApplyResult, type PspWebhookPayload } from "@/lib/psp-webhook";
import { queueMode } from "@/lib/queue-mode";
import { verifyWebhookSignatureGeneric } from "@/lib/webhook-signing";

// ---------------------------------------------------------------------------
// Boîte de réception des webhooks PSP (inbox), 2026-10-01.
//
// La route ne fait plus que trois choses : vérifier la signature, consigner le corps BRUT, rendre
// la main. Le traitement — qui prend le verrou du contrat, clôture, instruit la retenue ou les
// créances en attente — se fait ensuite, par le worker (mode `worker`) ou dans la foulée (mode
// `inline`). Un pic de webhooks n'est plus un pic de transactions verrouillées dans le serveur
// web, et un traitement qui échoue n'oblige plus le PSP à réessayer : la ligne reste là.
//
// Le corps est conservé tel quel : la signature HMAC porte sur lui, elle est revérifiée au
// traitement par `applyPspWebhookEvent`, le seul chemin qui confirme un mouvement (US-503).
// ---------------------------------------------------------------------------

const LEASE_MS = 60_000;
/** Tentatives sur une erreur TECHNIQUE (exception) avant de passer la ligne en `echec`. */
export const MAX_INBOUND_ATTEMPTS = 8;
/**
 * Un webhook peut devancer la validation de la transaction qui a créé l'opération (le PSP est
 * rapide, notre commit l'est moins) : `operation_not_found` est d'abord repris, puis abandonné.
 */
const MAX_NOT_FOUND_ATTEMPTS = 5;

export function inboundBackoffMs(attempt: number): number {
  return Math.min(5_000 * 2 ** Math.max(0, attempt - 1), 15 * 60_000);
}

export type WebhookReception =
  | { status: 200; body: { received: true; queued?: true; duplicate?: true } }
  | { status: 400 | 401 | 409 | 500; body: { error: string } };

/** Point d'entrée de POST /api/webhooks/psp. */
export async function receivePspWebhook(rawBody: string, signature: string | null): Promise<WebhookReception> {
  const startedAt = Date.now();
  let payload: PspWebhookPayload | null = null;
  try {
    payload = JSON.parse(rawBody) as PspWebhookPayload;
  } catch {
    payload = null;
  }

  // Les refus AVANT traitement sont consignés eux aussi : ce sont les appels les plus suspects.
  const reject = async (status: 400 | 401 | 409, error: string): Promise<WebhookReception> => {
    await recordPspEvent({
      channel: "webhook",
      payload: payload ?? {},
      signatureValid: false,
      durationMs: Date.now() - startedAt,
      outcome: "rejected",
      error,
    });
    return { status, body: { error } };
  };

  if (!signature) return reject(401, "missing_signature");
  if (typeof payload?.pspReference !== "string" || typeof payload?.event !== "string") {
    return reject(400, "invalid_payload");
  }
  // Vérifiée ICI, avant d'écrire quoi que ce soit : une signature fausse ne doit pas pouvoir
  // remplir la table.
  if (!verifyWebhookSignatureGeneric(payload as unknown as Record<string, unknown>, signature)) {
    return reject(409, "invalid_signature");
  }

  const { row, duplicate } = await storeInbound(payload, rawBody, signature);

  if (queueMode() === "worker") {
    if (duplicate) {
      // Rien à retraiter ; la trace « rejoué » reste utile au diagnostic de l'intégration.
      await recordPspEvent({
        channel: "webhook",
        payload,
        signatureValid: true,
        durationMs: Date.now() - startedAt,
        outcome: "replayed",
        error: null,
      });
      return { status: 200, body: { received: true, duplicate: true } };
    }
    return { status: 200, body: { received: true, queued: true } };
  }

  // Mode inline : traitement immédiat, réponse porteuse du résultat (comportement historique).
  // Un doublon déjà traité est rejoué tel quel — la machine à états le rend idempotent.
  const result = duplicate && isFinal(row.status)
    ? await applyPspWebhookEvent(payload, signature, "webhook")
    : await processInboundEvent(row.id);
  if (!result || result.ok) return { status: 200, body: { received: true } };
  // Erreur technique : 500, pour que le PSP réessaie — la ligne est de toute façon reprogrammée.
  return { status: result.error === "internal_error" ? 500 : 409, body: { error: result.error } };
}

function isFinal(status: PspInboundEvent["status"]): boolean {
  return status === "traite" || status === "rejete" || status === "echec";
}

async function storeInbound(
  payload: PspWebhookPayload,
  rawBody: string,
  signature: string
): Promise<{ row: PspInboundEvent; duplicate: boolean }> {
  try {
    const row = await prisma.pspInboundEvent.create({
      data: { pspReference: payload.pspReference.slice(0, 200), event: payload.event.slice(0, 64), rawBody, signature },
    });
    return { row, duplicate: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const row = await prisma.pspInboundEvent.findUniqueOrThrow({
        where: { pspReference_event: { pspReference: payload.pspReference.slice(0, 200), event: payload.event.slice(0, 64) } },
      });
      return { row, duplicate: true };
    }
    throw error;
  }
}

type ClaimedInbound = Pick<PspInboundEvent, "id" | "rawBody" | "signature" | "attempts">;

async function claimInbound(filter: { id: string } | { limit: number }): Promise<ClaimedInbound[]> {
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const byId = "id" in filter ? Prisma.sql`AND id = ${filter.id}` : Prisma.empty;
  const limit = "id" in filter ? 1 : filter.limit;
  return prisma.$queryRaw<ClaimedInbound[]>`
    UPDATE "PspInboundEvent"
       SET status = 'en_cours', "leaseUntil" = ${utcTimestamp(leaseUntil)}, attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM "PspInboundEvent"
        WHERE ((status = 'recu' AND "nextAttemptAt" <= ${utcTimestamp(now)})
            OR (status = 'en_cours' AND "leaseUntil" < ${utcTimestamp(now)}))
          ${byId}
        ORDER BY "receivedAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, "rawBody", signature, attempts`;
}

async function handle(row: ClaimedInbound): Promise<ApplyResult> {
  const finish = (data: Prisma.PspInboundEventUpdateInput) =>
    prisma.pspInboundEvent.update({ where: { id: row.id }, data: { leaseUntil: null, ...data } });
  try {
    const payload = JSON.parse(row.rawBody) as PspWebhookPayload;
    const result = await applyPspWebhookEvent(payload, row.signature, "webhook");
    if (result.ok) {
      await finish({ status: "traite", processedAt: new Date(), lastError: null });
    } else if (result.error === "operation_not_found" && row.attempts < MAX_NOT_FOUND_ATTEMPTS) {
      await finish({ status: "recu", lastError: result.error, nextAttemptAt: new Date(Date.now() + inboundBackoffMs(row.attempts)) });
    } else {
      await finish({ status: "rejete", processedAt: new Date(), lastError: result.error });
    }
    return result;
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const exhausted = row.attempts >= MAX_INBOUND_ATTEMPTS;
    await finish({
      status: exhausted ? "echec" : "recu",
      lastError: message,
      nextAttemptAt: new Date(Date.now() + inboundBackoffMs(row.attempts)),
    });
    console.error(`[psp-inbox] ${row.id} tentative ${row.attempts} : ${message}`);
    return { ok: false, error: "internal_error" };
  }
}

/** Traite UNE ligne si personne d'autre ne la détient. `null` : déjà prise ou déjà traitée. */
export async function processInboundEvent(id: string): Promise<ApplyResult | null> {
  const [row] = await claimInbound({ id });
  return row ? handle(row) : null;
}

/** Tour de worker : réclame un lot de webhooks reçus et les applique, dans l'ordre d'arrivée. */
export async function processDueInboundEvents(limit = 50): Promise<{ processed: number; failed: number }> {
  const rows = await claimInbound({ limit });
  let failed = 0;
  for (const row of rows) if (!(await handle(row)).ok) failed++;
  return { processed: rows.length, failed };
}
