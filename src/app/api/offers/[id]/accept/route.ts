import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { acceptProposal } from "@/lib/accept-proposal";
import { kycBlockFor } from "@/lib/kyc-policy";

// Le prestataire accepte une offre formelle reçue (model Offer). Réutilise exactement la
// même logique que l'acceptation directe d'une candidature (src/lib/accept-proposal.ts) —
// une offre acceptée doit produire le même état qu'une candidature acceptée par le client,
// pas un second chemin qui pourrait diverger.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  // Accepter une offre vaut candidature : identité vérifiée exigée (src/lib/kyc-policy.ts).
  const kycBlock = await kycBlockFor(userId, "candidater");
  if (kycBlock) {
    return NextResponse.json(kycBlock, { status: 403 });
  }
  const { id: offerId } = await params;

  const offer = await prisma.offer.findFirst({ where: { id: offerId, providerId: userId } });
  if (!offer) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (offer.status !== "envoyee") {
    return NextResponse.json({ error: "offer_not_pending" }, { status: 409 });
  }

  if (offer.proposalId) {
    await acceptProposal(offer.missionId, offer.proposalId);
  }

  const updated = await prisma.offer.update({
    where: { id: offerId },
    data: { status: "acceptee", acceptedAt: new Date() },
  });

  return NextResponse.json(updated);
}
