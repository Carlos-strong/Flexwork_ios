import { prisma } from "@/lib/db";
import { cancelExpiredContract, COUNTER_SIGN_DEADLINE_MS } from "@/lib/contract-expiry";
import { refundExpiredOrder, PROVIDER_SIGN_DEADLINE_MS } from "@/lib/gig-expiry";
import { deleteStoredFile } from "@/lib/storage";

// ---------------------------------------------------------------------------
// Tâches d'expiration et de purge (2026-10-01) — extraites des routes /api/cron/* pour être
// exécutées indifféremment par le cron système (route HTTP, Bearer CRON_SECRET) ou par le worker
// (planification pg-boss, src/worker/index.ts). Le corps est celui des routes, inchangé.
// ---------------------------------------------------------------------------

/** Contrats signés par le prestataire (1/2) que le client n'a pas contre-signés dans les 48 h. */
export async function expireUnsignedContracts(): Promise<{ cancelled: number }> {
  const cutoff = new Date(Date.now() - COUNTER_SIGN_DEADLINE_MS);
  const expired = await prisma.prestationContract.findMany({
    where: { providerSignedAt: { not: null, lt: cutoff }, clientSignedAt: null },
    select: { id: true },
  });
  let cancelled = 0;
  for (const c of expired) {
    if (await cancelExpiredContract(c.id)) cancelled++;
  }
  return { cancelled };
}

// Négociations de devis expirées (mode QUOTE). Basé sur la date d'expiration de la mission, PAS
// sur le compteur de rounds : le dernier round doit rester utilisable.
export async function expireDevisNegotiations(): Promise<{ cancelled: number }> {
  const expired = await prisma.missionProposal.findMany({
    where: {
      status: { in: ["preselectionnee", "en_negociation"] },
      mission: { dateExpiration: { lt: new Date() } },
    },
    select: { id: true },
  });
  if (expired.length > 0) {
    await prisma.missionProposal.updateMany({
      where: { id: { in: expired.map((p) => p.id) } },
      data: { status: "annulee_definitive" },
    });
  }
  return { cancelled: expired.length };
}

/** Commandes Gig que le prestataire n'a pas signées sous 24 h : annulées et remboursées. */
export async function expireGigOrders(): Promise<{ refunded: number }> {
  const cutoff = new Date(Date.now() - PROVIDER_SIGN_DEADLINE_MS);
  const expired = await prisma.gigOrder.findMany({
    where: { clientSignedAt: { not: null, lt: cutoff }, providerSignedAt: null, status: "client_signed" },
    select: { id: true },
  });
  let refunded = 0;
  for (const o of expired) {
    if (await refundExpiredOrder(o.id)) refunded++;
  }
  return { refunded };
}

// Purge des pièces jointes de brouillons abandonnés (2026-09-23). Trente jours, volontairement
// plus que les sept du brouillon local (`mission-draft.ts`) : purger au même rythme risquerait
// d'effacer les fichiers d'un brouillon encore restaurable.
const DRAFT_ATTACHMENT_MAX_AGE_DAYS = 30;

export async function cleanupDraftAttachments(): Promise<{ deleted: number; filesRemoved: number }> {
  const cutoff = new Date(Date.now() - DRAFT_ATTACHMENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const stale = await prisma.missionDraftAttachment.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, filePath: true },
  });
  if (stale.length === 0) return { deleted: 0, filesRemoved: 0 };

  // Les LIGNES d'abord : ce sont elles qui rendent un fichier atteignable. Un échec disque
  // ensuite laisse un fichier orphelin inerte, plutôt qu'une ligne pointant vers le vide.
  await prisma.missionDraftAttachment.deleteMany({ where: { id: { in: stale.map((s) => s.id) } } });
  let filesRemoved = 0;
  for (const item of stale) {
    try {
      await deleteStoredFile(item.filePath);
      filesRemoved += 1;
    } catch {
      // Fichier déjà absent ou illisible : la ligne est partie, on continue la purge.
    }
  }
  return { deleted: stale.length, filesRemoved };
}
