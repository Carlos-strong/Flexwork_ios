import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { detectMutualReviewSuspicion } from "@/lib/fraud-heuristics";

const schema = z.object({
  targetId: z.string(),
  note: z.number().int().min(1).max(5),
  commentaire: z.string().optional(),
});

// US-406 (F15) : avis noté 1 à 5 après la mission.
// US-1310 : suspendu si un litige a été ouvert sur la mission, pour empêcher l'extorsion à l'avis.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: { proposals: true, contract: { include: { mediations: true } } },
  });
  if (!mission) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const isParticipant =
    mission.clientId === userId || mission.proposals.some((p) => p.providerId === userId);
  if (!isParticipant) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Une médiation déjà ouverte (même résolue) sur ce contrat suspend l'avis — empêche
  // l'extorsion à l'avis (une partie de mauvaise foi menaçant l'autre d'un mauvais avis
  // après avoir ouvert une médiation).
  const mediationDejaOuverte = (mission.contract?.mediations.length ?? 0) > 0;

  const review = await prisma.review.create({
    data: {
      missionId,
      authorId: userId,
      targetId: parsed.data.targetId,
      note: parsed.data.note,
      commentaire: parsed.data.commentaire,
      suspendu: mediationDejaOuverte,
    },
  });

  // Détection heuristique de réciprocité suspecte entre les deux comptes.
  const pastMissions = await prisma.mission.findMany({
    where: {
      OR: [
        { clientId: userId, proposals: { some: { providerId: parsed.data.targetId, status: "acceptee" } } },
        { clientId: parsed.data.targetId, proposals: { some: { providerId: userId, status: "acceptee" } } },
      ],
    },
    include: { reviews: true },
    orderBy: { createdAt: "asc" },
  });

  const pairs = pastMissions
    .map((m) => {
      const authorReview = m.reviews.find((r) => r.authorId === userId && r.targetId === parsed.data.targetId);
      const targetReview = m.reviews.find((r) => r.authorId === parsed.data.targetId && r.targetId === userId);
      if (!authorReview || !targetReview) return null;
      return { authorToTarget: authorReview.note, targetToAuthor: targetReview.note };
    })
    .filter((p): p is { authorToTarget: number; targetToAuthor: number } => p !== null);

  const suspicious = detectMutualReviewSuspicion(pairs);

  return NextResponse.json({
    id: review.id,
    suspendu: review.suspendu,
    mutualReviewFlag: suspicious,
  });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: missionId } = await params;
  const reviews = await prisma.review.findMany({
    where: { missionId, suspendu: false },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items: reviews });
}
