import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { deliverMail, sendMail, type MailParams } from "@/lib/mail";
import { queueMode } from "@/lib/queue-mode";
import { utcTimestamp } from "@/lib/sql-time";

// ---------------------------------------------------------------------------
// Boîte d'envoi des e-mails (2026-10-01).
//
// Mode `inline` : envoi immédiat, comme avant (`sendMail`, qui absorbe l'erreur).
// Mode `worker` : l'e-mail est ÉCRIT dans `EmailOutbox` et le worker le remet au SMTP. Une
// notification ne coûte plus qu'un INSERT à la requête qui la déclenche — une validation qui
// prévient deux parties n'attend plus deux allers-retours SMTP — et un SMTP en panne ne fait
// plus perdre l'e-mail : il est repris (1 min, 2 min, 4 min… plafonné à 1 h, 6 tentatives).
//
// Même réclamation par bail que les files PSP (`FOR UPDATE SKIP LOCKED`) : plusieurs répliques
// du worker se partagent la table sans jamais envoyer deux fois la même ligne.
// ---------------------------------------------------------------------------

export const MAX_EMAIL_ATTEMPTS = 6;
const LEASE_MS = 60_000;

export function emailBackoffMs(attempt: number): number {
  return Math.min(60_000 * 2 ** Math.max(0, attempt - 1), 60 * 60_000);
}

/** Envoie l'e-mail (inline) ou le met en file (worker). Ne lève jamais. */
export async function queueMail(params: MailParams & { kind?: string }): Promise<void> {
  const { kind, ...mail } = params;
  if (queueMode() !== "worker") {
    await sendMail(mail);
    return;
  }
  try {
    await prisma.emailOutbox.create({ data: { ...mail, kind: kind?.slice(0, 64) ?? null } });
  } catch (error) {
    // Même règle que l'envoi direct : un e-mail raté ne fait jamais échouer l'action métier.
    console.error(`[mail-queue] mise en file impossible (${kind ?? "?"}, ${mail.to}) :`, error);
  }
}

type ClaimedEmail = { id: string; to: string; subject: string; text: string; html: string | null; attempts: number };

async function claimEmails(limit: number): Promise<ClaimedEmail[]> {
  const now = new Date();
  return prisma.$queryRaw<ClaimedEmail[]>`
    UPDATE "EmailOutbox"
       SET status = 'en_cours', "leaseUntil" = ${utcTimestamp(new Date(now.getTime() + LEASE_MS))}, attempts = attempts + 1
     WHERE id IN (
       SELECT id FROM "EmailOutbox"
        WHERE (status = 'a_envoyer' AND "nextAttemptAt" <= ${utcTimestamp(now)})
           OR (status = 'en_cours' AND "leaseUntil" < ${utcTimestamp(now)})
        ORDER BY "nextAttemptAt"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
     )
    RETURNING id, "to", subject, text, html, attempts`;
}

export type EmailDeliveryCounts = { sent: number; retried: number; abandoned: number };

/** Tour de worker : remet au SMTP un lot d'e-mails dus. */
export async function deliverDueEmails(limit = 20): Promise<EmailDeliveryCounts> {
  const rows = await claimEmails(limit);
  const counts: EmailDeliveryCounts = { sent: 0, retried: 0, abandoned: 0 };
  for (const row of rows) {
    try {
      await deliverMail({ to: row.to, subject: row.subject, text: row.text, html: row.html ?? undefined });
      await prisma.emailOutbox.update({
        where: { id: row.id },
        data: { status: "envoye", sentAt: new Date(), leaseUntil: null, lastError: null },
      });
      counts.sent++;
    } catch (error) {
      const abandoned = row.attempts >= MAX_EMAIL_ATTEMPTS;
      const data: Prisma.EmailOutboxUpdateInput = {
        status: abandoned ? "echec" : "a_envoyer",
        leaseUntil: null,
        lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
        nextAttemptAt: new Date(Date.now() + emailBackoffMs(row.attempts)),
      };
      await prisma.emailOutbox.update({ where: { id: row.id }, data });
      counts[abandoned ? "abandoned" : "retried"]++;
    }
  }
  return counts;
}

/** Purge des e-mails envoyés au-delà de `days` jours : la table ne doit pas croître sans fin. */
export async function purgeSentEmails(days = 30): Promise<number> {
  const { count } = await prisma.emailOutbox.deleteMany({
    where: { status: "envoye", sentAt: { lt: new Date(Date.now() - days * 24 * 60 * 60_000) } },
  });
  return count;
}

export async function emailQueueHealth(): Promise<{ pending: number; late: number; failed: number }> {
  const late = new Date(Date.now() - 10 * 60_000);
  const [pending, lateCount, failed] = await Promise.all([
    prisma.emailOutbox.count({ where: { status: { in: ["a_envoyer", "en_cours"] } } }),
    prisma.emailOutbox.count({ where: { status: { in: ["a_envoyer", "en_cours"] }, createdAt: { lt: late } } }),
    prisma.emailOutbox.count({ where: { status: "echec" } }),
  ]);
  return { pending, late: lateCount, failed };
}
