import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

const schema = z.object({ utile: z.boolean().nullable() });

// « Cet avis vous a-t-il été utile ? » (2026-11-10). Un vote par lecteur connecté et par avis ;
// `utile: null` retire le vote. Ni l'auteur ni la cible de l'avis ne votent — sinon le
// prestataire ferait remonter ses meilleurs avis dans le tri « Pertinents ». Un avis suspendu
// (médiation) n'est pas affiché, donc pas votable : 404 comme un avis inexistant.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as { id: string }).id;
  const { id: reviewId } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const review = await prisma.review.findUnique({
    where: { id: reviewId },
    select: { authorId: true, targetId: true, suspendu: true },
  });
  if (!review || review.suspendu) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (review.authorId === userId || review.targetId === userId) {
    return NextResponse.json({ error: "own_review" }, { status: 403 });
  }

  const key = { reviewId_userId: { reviewId, userId } };
  if (parsed.data.utile === null) {
    await prisma.reviewVote.deleteMany({ where: { reviewId, userId } });
  } else {
    await prisma.reviewVote.upsert({
      where: key,
      create: { reviewId, userId, utile: parsed.data.utile },
      update: { utile: parsed.data.utile },
    });
  }
  const utileCount = await prisma.reviewVote.count({ where: { reviewId, utile: true } });
  return NextResponse.json({ monVote: parsed.data.utile, utileCount });
}
