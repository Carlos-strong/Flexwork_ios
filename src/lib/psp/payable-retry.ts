import { prisma } from "@/lib/db";
import { instructOwedPayable } from "@/lib/escrow";

// ---------------------------------------------------------------------------
// Reprise automatique des versements refusés par le PSP (2026-10-01).
//
// La règle posée par `instructOwedPayables` tient toujours : un refus du PSP se reprend par une
// DÉCISION — le client revalide son jalon (le webhook `failed` remet le jalon `livrable_soumis`),
// ou l'administration réinstruit. Reprendre ces créances-là en boucle doublerait le geste du
// client.
//
// Une seule source n'a AUCUN geste pour la porter : la créance de PRÉSENCE. Un relevé validé ne
// se valide pas deux fois ; sans reprise, le prestataire attendait qu'un administrateur remarque
// la ligne. C'est elle, et elle seule, que ce module reprend : quelques tentatives espacées, puis
// la main revient à l'administration (console « à réinstruire »), comme avant.
// ---------------------------------------------------------------------------

export const MAX_PAYABLE_RETRIES = 3;
const AUTO_RETRY_SOURCES = ["attendance"] as const;

/** Attente avant la reprise n° `retryCount + 1` : 5 min, 30 min, 3 h. */
export function payableRetryDelayMs(retryCount: number): number {
  return [5 * 60_000, 30 * 60_000, 3 * 60 * 60_000][Math.min(retryCount, 2)];
}

/** Appelé par le webhook `failed` : programme la reprise de la créance portée par l'opération. */
export async function scheduleFailedPayableRetry(escrowOperationId: string): Promise<void> {
  const payable = await prisma.payable.findUnique({
    where: { escrowOperationId },
    select: { id: true, sourceType: true, retryCount: true },
  });
  if (!payable) return;
  if (!(AUTO_RETRY_SOURCES as readonly string[]).includes(payable.sourceType)) return;
  if (payable.retryCount >= MAX_PAYABLE_RETRIES) return;
  await prisma.payable.update({
    where: { id: payable.id },
    data: { nextRetryAt: new Date(Date.now() + payableRetryDelayMs(payable.retryCount)) },
  });
}

export type PayableRetryCounts = { instructed: number; waitingFunds: number; skipped: number };

/** Tour de worker : réinstruit les créances dont la reprise est échue. */
export async function retryDuePayables(limit = 50): Promise<PayableRetryCounts> {
  const now = new Date();
  const due = await prisma.payable.findMany({
    where: { status: "failed", nextRetryAt: { lte: now } },
    orderBy: { nextRetryAt: "asc" },
    take: limit,
    select: { id: true, nextRetryAt: true },
  });
  const counts: PayableRetryCounts = { instructed: 0, waitingFunds: 0, skipped: 0 };
  for (const p of due) {
    // Réclamation : seul le worker qui efface CETTE échéance traite la créance. Le compteur monte
    // ici, avant l'instruction — une reprise qui plante n'est pas rejouée indéfiniment.
    const { count } = await prisma.payable.updateMany({
      where: { id: p.id, status: "failed", nextRetryAt: p.nextRetryAt },
      data: { nextRetryAt: null, retryCount: { increment: 1 } },
    });
    if (count === 0) {
      counts.skipped++;
      continue;
    }
    const res = await instructOwedPayable(p.id);
    if (res.ok) counts.instructed++;
    else if (res.reason === "escrow_insufficient") {
      // Plus assez de fonds : la créance redevient « due, en attente de séquestre » — l'état que
      // la confirmation d'une recharge relance d'elle-même (instructOwedPayables).
      await prisma.payable.updateMany({ where: { id: p.id, status: "failed" }, data: { status: "validated" } });
      counts.waitingFunds++;
    } else counts.skipped++;
  }
  return counts;
}
