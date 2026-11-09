import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canReviewAtStatus, legitimateReviewTarget, retainedProviderIds } from "@/lib/review-rules";
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

  // Chronologie (audit workflow A-1) : un avis conclut une mission TERMINÉE. Sans ce garde,
  // l'API acceptait un avis dès `publiee` alors que l'interface ne le propose qu'à la
  // clôture — l'UI n'est pas une frontière.
  if (!canReviewAtStatus(mission.status)) {
    return NextResponse.json({ error: "mission_not_completed" }, { status: 409 });
  }

  // Ciblage : seule l'autre partie de la relation RETENUE peut être notée, et seul un membre
  // de cette relation peut noter. Sans ce garde, un candidat refusé (participant via
  // proposals.some sans filtre de statut) pouvait noter le client, et `targetId` n'était
  // jamais confronté aux parties réelles. `retainedProviderIds` couvre les DEUX statuts de
  // proposition retenue (acceptee pour prix fixe/taux, devis_valide pour le mode devis) —
  // sans cette seconde valeur, aucun avis n'était possible sur une mission à devis clôturée.
  const acceptedProviderIds = retainedProviderIds(mission.proposals);
  const allowedTargets = legitimateReviewTarget({ authorId: userId, clientId: mission.clientId, acceptedProviderIds });
  if (!allowedTargets.includes(parsed.data.targetId)) {
    return NextResponse.json({ error: "invalid_target" }, { status: 403 });
  }

  // Une médiation déjà ouverte (même résolue) sur ce contrat suspend l'avis — empêche
  // l'extorsion à l'avis (une partie de mauvaise foi menaçant l'autre d'un mauvais avis
  // après avoir ouvert une médiation).
  const mediationDejaOuverte = (mission.contract?.mediations.length ?? 0) > 0;

  // Un seul avis par auteur et par mission (@@unique([missionId, authorId])). Sans ce garde,
  // un second envoi remontait en violation de contrainte non interceptée, donc en 500 — une
  // erreur serveur pour un geste parfaitement prévisible côté utilisateur.
  const dejaNote = await prisma.review.findFirst({ where: { missionId, authorId: userId } });
  if (dejaNote) {
    return NextResponse.json({ error: "already_reviewed" }, { status: 409 });
  }

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

  // `target` — QUI l'appelant peut noter sur cette mission. Exposé par l'API plutôt que deviné
  // côté page : c'est le POST qui arbitre (legitimateReviewTarget), et la page n'a aucun moyen
  // honnête de reconstituer la contrepartie à partir de l'URL. Elle envoyait faute de mieux
  // l'id de la MISSION comme `targetId`, que le POST rejetait invariablement en 403
  // invalid_target — aucun avis n'était publiable, par aucune des deux parties.
  // Une seule source de vérité, la même fonction des deux côtés.
  const session = await auth();
  const userId = session?.user
    ? (session.user as typeof session.user & { id: string }).id
    : null;

  let target: { id: string; nom: string } | null = null;
  if (userId) {
    const mission = await prisma.mission.findUnique({
      where: { id: missionId },
      include: { proposals: true },
    });
    if (mission) {
      const allowed = legitimateReviewTarget({
        authorId: userId,
        clientId: mission.clientId,
        acceptedProviderIds: retainedProviderIds(mission.proposals),
      });
      if (allowed.length > 0) {
        const user = await prisma.user.findUnique({
          where: { id: allowed[0] },
          select: { id: true, firstname: true, lastname: true },
        });
        if (user) {
          target = {
            id: user.id,
            nom: [user.firstname, user.lastname].filter(Boolean).join(" ") || "la contrepartie",
          };
        }
      }
    }
  }

  return NextResponse.json({ items: reviews, target });
}
