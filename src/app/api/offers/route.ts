import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Offres reçues par le prestataire connecté (model Offer) — alimente OffresSection.tsx,
// même modèle que GET /api/dashboard/my-proposals.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const offers = await prisma.offer.findMany({
    where: { providerId: userId },
    include: {
      mission: {
        select: { id: true, titre: true, domaine: true, status: true },
      },
      client: { select: { id: true, firstname: true, lastname: true, country: true, avatarPath: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ items: offers });
}
