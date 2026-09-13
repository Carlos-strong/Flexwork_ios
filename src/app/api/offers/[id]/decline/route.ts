import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Le prestataire refuse une offre formelle reçue. Ne touche volontairement pas au statut de
// la candidature sous-jacente (Offer.proposalId) : le client garde la main pour proposer
// l'offre à un autre candidat ou revenir vers celui-ci, ce refus ne clôt que l'offre elle-même.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: offerId } = await params;

  const offer = await prisma.offer.findFirst({ where: { id: offerId, providerId: userId } });
  if (!offer) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (offer.status !== "envoyee") {
    return NextResponse.json({ error: "offer_not_pending" }, { status: 409 });
  }

  const updated = await prisma.offer.update({
    where: { id: offerId },
    data: { status: "refusee", declinedAt: new Date() },
  });

  return NextResponse.json(updated);
}
