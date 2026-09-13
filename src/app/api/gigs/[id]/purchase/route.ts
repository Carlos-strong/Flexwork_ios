import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// POST /api/gigs/[id]/purchase — un CLIENT achète un Gig publié → création de la commande
// (GigOrder, statut `created`) avec snapshot immuable du Gig. Le client signe ensuite en
// premier (1/2) sur la page commande (flux inversé), ce qui déclenche la mise sous séquestre.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;

  const gig = await prisma.gig.findUnique({ where: { id: (await params).id } });
  if (!gig || gig.status !== "publie") {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Un client ne peut pas acheter son propre Gig (invariant famille 4, même principe que
  // self_dealing_forbidden côté Mission).
  if (gig.providerId === userId) {
    return NextResponse.json({ error: "self_dealing_forbidden", message: "Vous ne pouvez pas acheter votre propre Gig." }, { status: 409 });
  }

  const order = await prisma.gigOrder.create({
    data: {
      gigId: gig.id,
      clientId: userId,
      providerId: gig.providerId,
      montant: gig.prix,
      currency: gig.currency,
      termsSnapshot: {
        gig: { id: gig.id, titre: gig.titre, description: gig.description, domaine: gig.domaine },
        prix: gig.prix,
        currency: gig.currency,
        delaiJours: gig.delaiJours,
        tags: gig.tags,
        dateAchat: new Date().toISOString(),
      },
      status: "created",
    },
  });

  return NextResponse.json({ orderId: order.id }, { status: 201 });
}
