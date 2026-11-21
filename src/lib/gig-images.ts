import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isPubliclyListed } from "@/lib/profile-visibility";

// Accès aux photos d'un Gig (2026-11-08) — partagé par les routes /api/gigs/[id]/images.

/** Gig du TITULAIRE connecté, ou la réponse d'erreur à renvoyer (401 / 404). */
export async function ownGigForImages(
  gigId: string,
): Promise<{ error: NextResponse } | { gig: { id: string; imagePaths: string[]; status: string; videoUrl: string | null } }> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  const gig = await prisma.gig.findFirst({
    where: { id: gigId, providerId: userId },
    select: { id: true, imagePaths: true, status: true, videoUrl: true },
  });
  if (!gig) return { error: NextResponse.json({ error: "not_found" }, { status: 404 }) };
  return { gig };
}

/**
 * Une photo est PUBLIQUE quand son Gig est publié par un prestataire listé (identité vérifiée,
 * compte actif) : elle s'affiche alors à tous, visiteurs compris (accueil, profil, page du
 * service). Sinon seul le titulaire la voit.
 */
export async function gigImagesVisibility(gigId: string) {
  const gig = await prisma.gig.findUnique({
    where: { id: gigId },
    select: {
      imagePaths: true,
      status: true,
      providerId: true,
      provider: { select: { kycStatus: true, status: true, role: true, _count: { select: { profiles: true } } } },
    },
  });
  if (!gig) return null;
  const isPublic = gig.status === "publie" && isPubliclyListed({ ...gig.provider, profileCount: gig.provider._count.profiles });
  return { imagePaths: gig.imagePaths, providerId: gig.providerId, isPublic };
}
