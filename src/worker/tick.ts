import { deliverDueEmails } from "@/lib/mail-queue";
import { dispatchDueOperations } from "@/lib/psp/dispatch";
import { processDueInboundEvents } from "@/lib/psp/inbox";

// Un tour de la boucle rapide du worker : transmettre les instructions PSP dues, appliquer les
// webhooks reçus, remettre les e-mails en attente au SMTP. Les trois tables sont réclamées par
// bail (`FOR UPDATE SKIP LOCKED`) : autant de répliques du worker qu'on veut peuvent tourner ce
// tour en parallèle.
export async function runWorkerTick(batch = 50): Promise<{ dispatched: number; inbound: number; emails: number; busy: boolean }> {
  const outbox = await dispatchDueOperations(batch);
  const inbox = await processDueInboundEvents(batch);
  const mail = await deliverDueEmails(Math.min(batch, 20));
  const dispatched = outbox.sent + outbox.retry_scheduled + outbox.abandoned;
  const emails = mail.sent + mail.retried + mail.abandoned;
  // Lot plein : il en reste probablement — la boucle repart sans attendre.
  return { dispatched, inbound: inbox.processed, emails, busy: dispatched >= batch || inbox.processed >= batch || emails >= 20 };
}
