import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { GigSignatureService } from "@/lib/gig-signature";
import { isOrderExpired, refundExpiredOrder } from "@/lib/gig-expiry";

export const dynamic = "force-dynamic";

// GET /api/gigs/orders/[orderId] — détail d'une commande Gig. Réservé aux DEUX parties
// (client ou prestataire) — un tiers reçoit 404, indistinguable d'une commande inexistante
// (règle R02). Si le délai de signature du prestataire (24h) est dépassé, la commande est
// remboursée automatiquement avant d'être renvoyée (idempotent).
export async function GET(_req: Request, { params }: { params: Promise<{ orderId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { orderId } = await params;

  const order = await prisma.gigOrder.findFirst({
    where: { id: orderId, OR: [{ clientId: userId }, { providerId: userId }] },
    include: {
      gig: { select: { titre: true, description: true, domaine: true, delaiJours: true } },
      // email requis côté page commande pour associer chaque signature (GigOrderSignature
      // porte signerEmail) au bon signataire (client vs prestataire).
      client: { select: { id: true, email: true, firstname: true, lastname: true, avatarPath: true } },
      provider: { select: { id: true, email: true, firstname: true, lastname: true, avatarPath: true } },
      escrowOperations: { select: { instructionType: true, status: true, amount: true, currency: true } },
    },
  });
  if (!order) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Annulation temporelle (24h) : le client a signé mais le prestataire n'a pas signé à
  // temps → remboursement automatique avant renvoi.
  if (isOrderExpired(order)) {
    await refundExpiredOrder(order.id);
    order.status = "refunded";
  }

  const verify = await GigSignatureService.verifySignature({ orderId }).catch(() => ({
    clientSignedAt: order.clientSignedAt?.toISOString() ?? null,
    providerSignedAt: order.providerSignedAt?.toISOString() ?? null,
    signatures: [],
  }));

  return NextResponse.json({
    id: order.id,
    gigId: order.gigId,
    gig: { titre: order.gig.titre, description: order.gig.description, domaine: order.gig.domaine, delaiJours: order.gig.delaiJours },
    montant: order.montant,
    currency: order.currency,
    termsSnapshot: order.termsSnapshot,
    status: order.status,
    clientSignedAt: order.clientSignedAt?.toISOString() ?? null,
    providerSignedAt: order.providerSignedAt?.toISOString() ?? null,
    refundedAt: order.refundedAt?.toISOString() ?? null,
    createdAt: order.createdAt,
    client: { id: order.client.id, email: order.client.email, name: [order.client.firstname, order.client.lastname].filter(Boolean).join(" ").trim() || "Client", avatarUrl: order.client.avatarPath ? `/api/users/${order.client.id}/avatar` : null },
    provider: { id: order.provider.id, email: order.provider.email, name: [order.provider.firstname, order.provider.lastname].filter(Boolean).join(" ").trim() || "Prestataire", avatarUrl: order.provider.avatarPath ? `/api/users/${order.provider.id}/avatar` : null },
    signatures: verify.signatures,
    escrow: order.escrowOperations.map((op) => ({ instructionType: op.instructionType, status: op.status, amount: op.amount, currency: op.currency })),
  });
}
