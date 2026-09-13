import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/gigs/[id] — détail d'un Gig. Publié → visible par tout utilisateur connecté ;
// brouillon/cloture → visible uniquement par son propriétaire (le prestataire). Tout autre
// cas → 404 (indistinguable d'un Gig inexistant).
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id: gigId } = await params;

  const gig = await prisma.gig.findFirst({
    where: {
      id: gigId,
      OR: [{ status: "publie" }, { providerId: userId }],
    },
    include: {
      provider: { select: { id: true, firstname: true, lastname: true, avatarPath: true } },
      _count: { select: { orders: true } },
    },
  });
  if (!gig) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    id: gig.id,
    titre: gig.titre,
    description: gig.description,
    domaine: gig.domaine,
    prix: gig.prix,
    currency: gig.currency,
    delaiJours: gig.delaiJours,
    tags: gig.tags,
    status: gig.status,
    createdAt: gig.createdAt,
    isOwn: gig.providerId === userId,
    ordersCount: gig._count.orders,
    provider: {
      id: gig.provider.id,
      name: [gig.provider.firstname, gig.provider.lastname].filter(Boolean).join(" ").trim() || "Prestataire",
      avatarUrl: gig.provider.avatarPath ? `/api/users/${gig.provider.id}/avatar` : null,
    },
  });
}
