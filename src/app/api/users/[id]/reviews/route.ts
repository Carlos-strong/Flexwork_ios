import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canViewProfile, isPubliclyListed } from "@/lib/profile-visibility";
import { ACCEPTED_PROPOSAL_STATUSES } from "@/lib/review-rules";
import { durationLabel, parseReviewQuery, priceBucket, rankReviews } from "@/lib/review-display";

// Avis reçus par un utilisateur (2026-11-10), filtrés, triés et paginés — la section « Avis »
// de /profil/[id]. Mêmes règles d'accès que /api/users/[id]/public-profile : un visiteur ne lit
// que les profils listés (401 sinon, qu'ils existent ou non), un connecté reçoit 404 hors des
// profils qu'il a le droit de voir.
//
// Ce qui est renvoyé pour chaque avis : la note, les sous-notes, le commentaire, la date, et ce
// qui SITUE l'avis sans identifier le client — son pays, si son identité est vérifiée, le métier
// de la mission, une fourchette de prix, la durée prévue, et s'il a déjà travaillé plusieurs
// fois avec ce prestataire. Jamais son nom ni son identifiant.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const { id: userId } = await params;
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, kycStatus: true, status: true, role: true, _count: { select: { profiles: true } } },
  });
  const target = user ? { ...user, profileCount: user._count.profiles } : null;
  if (!session?.user && !isPubliclyListed(target)) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const viewer = session?.user
    ? { id: (session.user as { id: string }).id, isAdmin: (session.user as { isAdmin?: boolean }).isAdmin === true }
    : null;
  if (!target || !(await canViewProfile(viewer, target))) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const q = parseReviewQuery(new URL(req.url).searchParams);

  // Phase 1 — champs légers de TOUS les avis visibles : de quoi filtrer, trier et compter.
  const light = await prisma.review.findMany({
    where: { targetId: userId, suspendu: false },
    select: {
      id: true,
      note: true,
      createdAt: true,
      authorId: true,
      commentaire: true,
      _count: { select: { votes: { where: { utile: true } } } },
    },
  });
  // Collaboration récurrente : l'auteur a noté ce prestataire sur au moins deux missions.
  const perAuthor = new Map<string, number>();
  for (const r of light) perAuthor.set(r.authorId, (perAuthor.get(r.authorId) ?? 0) + 1);
  const rankable = light.map((r) => ({
    id: r.id,
    authorId: r.authorId,
    note: r.note,
    createdAt: r.createdAt,
    hasComment: !!r.commentaire?.trim(),
    utileCount: r._count.votes,
    recurrent: (perAuthor.get(r.authorId) ?? 0) > 1,
  }));
  const ranked = rankReviews(rankable, q);
  const page = ranked.slice(q.offset, q.offset + q.take);

  // Phase 2 — détail de la seule page affichée.
  const details = page.length
    ? await prisma.review.findMany({
        where: { id: { in: page.map((r) => r.id) } },
        select: {
          id: true,
          note: true,
          noteCommunication: true,
          noteQualite: true,
          noteValeur: true,
          commentaire: true,
          createdAt: true,
          author: { select: { country: true, kycStatus: true } },
          mission: {
            select: {
              domaine: true,
              budget: true,
              currency: true,
              delaiJours: true,
              metier: { select: { libelle: true } },
              proposals: {
                where: { providerId: userId, status: { in: [...ACCEPTED_PROPOSAL_STATUSES] } },
                select: { montant: true, delaiPropose: true },
                take: 1,
              },
            },
          },
          votes: viewer ? { where: { userId: viewer.id }, select: { utile: true } } : false,
        },
      })
    : [];
  const byId = new Map(details.map((d) => [d.id, d]));

  return NextResponse.json({
    total: ranked.length,
    counts: {
      tous: rankable.length,
      avecCommentaire: rankable.filter((r) => r.hasComment).length,
      recurrents: rankable.filter((r) => r.recurrent).length,
    },
    offset: q.offset,
    items: page.flatMap((r) => {
      const d = byId.get(r.id);
      if (!d) return [];
      const retained = d.mission.proposals[0];
      const montant = retained?.montant || d.mission.budget;
      const myVote = (d as { votes?: { utile: boolean }[] }).votes?.[0];
      return [
        {
          id: d.id,
          note: d.note,
          sousNotes: { communication: d.noteCommunication, qualite: d.noteQualite, valeur: d.noteValeur },
          commentaire: d.commentaire,
          createdAt: d.createdAt,
          pays: d.author.country,
          clientVerifie: d.author.kycStatus === "verifie",
          recurrent: r.recurrent,
          metier: d.mission.metier?.libelle ?? d.mission.domaine,
          prix: priceBucket(montant, d.mission.currency),
          duree: durationLabel(retained?.delaiPropose ?? d.mission.delaiJours),
          utileCount: r.utileCount,
          monVote: myVote ? myVote.utile : null,
          // Ni l'auteur (identifié côté serveur seulement) ni la cible ne votent.
          peutVoter: !!viewer && viewer.id !== userId && viewer.id !== r.authorId,
        },
      ];
    }),
  });
}
