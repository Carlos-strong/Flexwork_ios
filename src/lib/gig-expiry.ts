import { prisma } from "@/lib/db";
import { GigSignatureService } from "@/lib/gig-signature";

// Délai de signature du prestataire (modèle Gig — flux inversé) : après la signature du
// client (1/2, fonds sous séquestre), le prestataire dispose de
// PROVIDER_SIGN_DEADLINE_HOURS pour signer (2/2). Passé ce délai, la commande est annulée
// et le client est remboursé automatiquement (aucune pénalité : personne n'est engagé tant
// que les deux signatures ne sont pas apposées). Recommandation #3 de
// REVUE-MODELE-CONTRAT-VS-IMPLEMENTATION.md.
export const PROVIDER_SIGN_DEADLINE_HOURS = 24;
export const PROVIDER_SIGN_DEADLINE_MS = PROVIDER_SIGN_DEADLINE_HOURS * 60 * 60 * 1000;

export function providerSignDeadline(clientSignedAt: Date): Date {
  return new Date(clientSignedAt.getTime() + PROVIDER_SIGN_DEADLINE_MS);
}

// Une commande est « expirée » si elle est encore dans l'état client_signed (client a signé
// mais le prestataire n'a pas signé dans le délai). Le garde `status === "client_signed"`
// rend le remboursement idempotent : une commande déjà `refunded`/`cancelled`/`active`/
// `completed` n'est jamais re-remboursée.
export function isOrderExpired(order: {
  clientSignedAt: Date | null;
  providerSignedAt: Date | null;
  status?: string;
}): boolean {
  return (
    order.status === "client_signed" &&
    !!order.clientSignedAt &&
    !order.providerSignedAt &&
    Date.now() > providerSignDeadline(order.clientSignedAt).getTime()
  );
}

// Annule une commande dont le délai de signature du prestataire est dépassé et déclenche
// le remboursement automatique au client. Idempotent. La plateforme ne détient jamais les
// fonds : une instruction REFUND est enregistrée (PspEscrowOperation, portée `gig_order`) — ici directement
// confirmée (pas de webhook PSP réel dans ce périmètre) — et le statut passe `refunded`.
export async function refundExpiredOrder(orderId: string): Promise<boolean> {
  const order = await prisma.gigOrder.findUnique({
    where: { id: orderId },
    select: {
      clientSignedAt: true,
      providerSignedAt: true,
      status: true,
      montant: true,
      currency: true,
      gig: { select: { titre: true } },
    },
  });
  if (!order) return false;
  // Rien à annuler : pas client_signed, déjà signé par le prestataire, ou déjà remboursé.
  if (!isOrderExpired(order)) return false;

  await prisma.$transaction([
    prisma.pspEscrowOperation.create({
      data: {
        sourceType: "gig_order",
        orderId,
        pspName: "gig-24h-refund",
        amount: order.montant,
        currency: order.currency,
        instructionType: "refund",
        status: "confirmed",
        pspConfirmedAt: new Date(),
      },
    }),
    prisma.gigOrder.update({
      where: { id: orderId },
      data: { status: "refunded", refundedAt: new Date() },
    }),
  ]);

  await GigSignatureService.addAuditEntry(
    orderId,
    "GIG_ORDER_EXPIRED",
    `Commande annulée — le prestataire n'a pas signé sous ${PROVIDER_SIGN_DEADLINE_HOURS}h ; remboursement automatique au client`
  );

  return true;
}
