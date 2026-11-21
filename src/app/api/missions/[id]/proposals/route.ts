import { NextResponse } from "next/server";
import { reserveUntil } from "@/lib/mission-expiry";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { proposalSchema } from "@/lib/validation";
import { submitProposalAs } from "@/lib/candidature-submit";
import { holdCandidatureForKyc } from "@/lib/proposal-drafts";
import { requireMissionParty } from "@/lib/resource-guard";

// Phase 4 : un prestataire propose un prix sur une mission à prix fixe/taux (budgetType !==
// "QUOTE" — le mode devis a sa propre route, POST /api/missions/[id]/devis).
// US-203 : bloqué tant que le KYC du prestataire n'est pas vérifié — l'autre des deux
// SEULES actions gatées par le KYC (l'autre étant la publication d'une mission).
// Règles de candidature (flowchart) :
//   - Mode distance → KYC vérifié uniquement (US-203, déjà en place)
//   - Mode présentiel/hybride → KYC + assurance si risque HIGH ; garant obligatoire
//     supplémentaire UNIQUEMENT si l'Admin KYC a activé « garant requis » pour ce
//     prestataire (User.garantRequired, défaut OFF — voir checkCandidatureEligibility)
//
// Négociation par rounds (2026-08-29) — même modèle que le mode devis, réutilisé tel quel
// (CLOSED_PROPOSAL_STATUSES, canProviderReviseDevis, computeDevisData, DevisRevision) plutôt
// que dupliqué : la 1ʳᵉ soumission reste "envoyee" (acceptation immédiate toujours possible,
// comme avant), une resoumission n'est permise que si le client a explicitement demandé une
// révision (POST .../request-revision, désormais utilisable dès "envoyee" — voir
// canClientRequestRevision/canClientRejectDevis, src/lib/devis.ts) et passe alors la
// candidature à "en_negociation", round+1 — jusqu'à acceptation mutuelle (POST .../accept),
// rejet explicite (POST .../devis/reject) ou épuisement de mission.maxRevisionRounds.
// `devisData` est renseigné avec UNE seule ligne synthétique (montant = totalTTC) : ça
// réutilise tel quel DevisDetails/Revisions (src/components/devis/devis-panel.tsx) pour
// l'affichage et l'historique, sans dupliquer ces composants pour ce mode.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: missionId } = await params;
  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  const body = await req.json().catch(() => null);
  const parsed = proposalSchema.safeParse(body);

  // KYC non vérifié : la candidature n'est pas perdue, elle est mise en brouillon pour être
  // envoyée telle quelle une fois l'identité vérifiée (src/lib/proposal-drafts.ts).
  const hold = await holdCandidatureForKyc({
    kind: "proposal",
    mission: mission && mission.budgetType !== "QUOTE" ? mission : null,
    payload: parsed.success ? (body as Prisma.InputJsonValue) : null,
  });
  if (hold.held) return NextResponse.json(hold.body, { status: hold.status });
  if (hold.providerId === null) return NextResponse.json(hold.response.body, { status: hold.response.status });
  const providerId = hold.providerId;
  return submitProposalAs({ missionId, providerId, mission, body });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as { id: string }).id;
  const { id: missionId } = await params;

  // F-01 : seuls les participants de la mission peuvent lire ses candidatures — le client
  // propriétaire voit TOUTES les propositions reçues, le PRESTATAIRE voit uniquement SA
  // candidature (même page /missions/[id]/proposals, rôle-aware depuis 2026-09-03). Un
  // tiers → 404, indistinguable d'une mission inexistante (règle R02 du standard de sécurité).
  const guard = await requireMissionParty(missionId, userId);
  if (!guard.ok) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const clientView = guard.isClient;

  const [proposals, mission] = await Promise.all([
    prisma.missionProposal.findMany({
      where: { missionId, ...(clientView ? {} : { providerId: userId }) },
      include: {
        provider: { select: { id: true, email: true, firstname: true, lastname: true, avatarPath: true, country: true } },
        revisions: {
          include: { author: { select: { firstname: true, lastname: true } } },
          orderBy: { roundNumber: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.mission.findUnique({
      where: { id: missionId },
      select: {
        budgetType: true,
        maxRevisionRounds: true,
        status: true,
        currency: true,
        titre: true,
        // Délai publié — repli de la colonne « Délai » quand le candidat n'en propose pas.
        delaiJours: true,
        // Budget publié — tuile « Budget mission » du récapitulatif du choix (2026-11-11).
        budget: true,
        // Annonce (2026-11-10) : période de candidature, places, et prestataires déjà retenus.
        dateExpiration: true,
        maxCandidatures: true,
        parentMissionId: true,
        // Mission déjà dans le parcours contrat (engagement, ou mission antérieure aux annonces).
        // Côté prestataire : seulement s'il est la partie du contrat (filtré plus bas).
        contract: { select: { clientSignedAt: true, providerSignedAt: true, providerId: true } },
        engagements: clientView
          ? {
              // Un engagement annulé (désistement, 2026-11-11) libère sa place.
              where: { status: { not: "annulee" } },
              select: {
                id: true,
                status: true,
                proposals: { select: { provider: { select: { firstname: true, lastname: true } } }, take: 1 },
                // État de signature : libellé du bouton « contrat » de chaque engagement.
                contract: { select: { clientSignedAt: true, providerSignedAt: true } },
              },
              orderBy: { createdAt: "asc" },
            }
          : false,
      },
    }),
  ]);

  // Note moyenne réelle par candidat (même agrégat que GET /api/users/[id]/public-profile) et
  // nombre d'offres déjà envoyées à ce candidat pour CETTE mission (model Offer) — alimente
  // les tuiles de pipeline réelles de la vue candidature côté client (pas de "Entretien"
  // fabriqué, cette notion n'existe pas dans le produit).
  // Candidatures RETENUES sur l'annonce (2026-11-11) — client propriétaire seulement. Retenir un
  // prestataire déplace sa candidature sur son ENGAGEMENT (src/lib/accept-proposal.ts) : sans
  // cette lecture, les retenus disparaissaient de la page. Chacune porte son engagement et
  // l'état de signature de son contrat (bouton « Signature du contrat »).
  const retainedRaw = clientView
    ? await prisma.missionProposal.findMany({
        where: { mission: { parentMissionId: missionId }, status: { in: ["acceptee", "devis_valide"] } },
        include: {
          provider: { select: { id: true, email: true, firstname: true, lastname: true, avatarPath: true, country: true } },
          revisions: { include: { author: { select: { firstname: true, lastname: true } } }, orderBy: { roundNumber: "asc" } },
          mission: { select: { id: true, status: true, contract: { select: { clientSignedAt: true, providerSignedAt: true } } } },
        },
        orderBy: { createdAt: "asc" },
      })
    : [];

  const providerIds = [...new Set([...proposals, ...retainedRaw].map((p) => p.providerId))];
  // Cartes « Candidatures reçues » (2026-11-11) : missions menées à terme — même définition que
  // le profil public (GET /api/users/[id]/public-profile : mission clôturée, candidature
  // acceptée) — et compétences déclarées du profil par défaut.
  const [reviews, offers, completed, profiles] = await Promise.all([
    prisma.review.findMany({ where: { targetId: { in: providerIds }, suspendu: false }, select: { targetId: true, note: true } }),
    prisma.offer.findMany({ where: { missionId, providerId: { in: providerIds } }, select: { providerId: true } }),
    prisma.missionProposal.groupBy({
      by: ["providerId"],
      where: { providerId: { in: providerIds }, status: "acceptee", mission: { status: "cloturee" } },
      _count: { _all: true },
    }),
    prisma.profile.findMany({ where: { userId: { in: providerIds } }, select: { userId: true, isDefault: true, tags: true } }),
  ]);
  const completedByProvider = new Map(completed.map((c) => [c.providerId, c._count._all]));
  const skillsByProvider = new Map<string, string[]>();
  for (const pr of [...profiles].sort((a, b) => Number(a.isDefault) - Number(b.isDefault))) {
    skillsByProvider.set(pr.userId, pr.tags); // le profil par défaut, trié en dernier, l'emporte
  }
  const ratingsByProvider = new Map<string, number[]>();
  for (const r of reviews) {
    (ratingsByProvider.get(r.targetId) ?? ratingsByProvider.set(r.targetId, []).get(r.targetId)!).push(r.note);
  }
  const offersByProvider = new Map<string, number>();
  for (const o of offers) {
    offersByProvider.set(o.providerId, (offersByProvider.get(o.providerId) ?? 0) + 1);
  }

  const enrich = <P extends { providerId: string }>(p: P) => {
    const ratings = ratingsByProvider.get(p.providerId);
    return {
      ...p,
      averageRating: ratings?.length ? ratings.reduce((s, n) => s + n, 0) / ratings.length : null,
      offersSent: offersByProvider.get(p.providerId) ?? 0,
      missionsCompleted: completedByProvider.get(p.providerId) ?? 0,
      skills: (skillsByProvider.get(p.providerId) ?? []).slice(0, 4),
    };
  };
  const items = proposals.map(enrich);
  const retained = retainedRaw.map(({ mission: engagement, ...p }) => ({
    ...enrich(p),
    engagement: { id: engagement.id, status: engagement.status, contract: engagement.contract },
  }));

  // Le contrat n'est exposé qu'à ses parties (le client, ou le prestataire retenu).
  const meta = mission
    ? (() => {
        const { contract, ...rest } = mission;
        const party = !!contract && (clientView || contract.providerId === userId);
        return {
          ...rest,
          contract: party ? { clientSignedAt: contract.clientSignedAt, providerSignedAt: contract.providerSignedAt } : null,
          // Réserve (2026-11-11) : jusqu'à quand le client peut retenir un candidat présélectionné
          // après la clôture (null si l'annonce n'est pas close).
          reserveUntil: reserveUntil(rest)?.toISOString() ?? null,
        };
      })()
    : null;
  return NextResponse.json({ items, retained, mission: meta });
}
