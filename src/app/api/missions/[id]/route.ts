import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { placesRecherchees } from "@/lib/mission-expiry";
import { contractPrice } from "@/lib/escrow";
import { isVirtualPspEnabled } from "@/lib/psp-virtual";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id } = await params;

  // `client` inclus ici uniquement pour l'affichage (bulle de messagerie côté prestataire,
  // src/components/chat/MessageBubble.tsx — l'interlocuteur du client propriétaire est
  // toujours non ambigu, contrairement au sens client→prestataire qui peut avoir plusieurs
  // candidats). `_count.proposals` : comptage sûr du nombre de candidatures, sans exposer
  // leur contenu (montants/positions des autres candidats) à qui appelle cette route — voir
  // la carte client de /missions/[id]/devis (page "Offre de candidature").
  const mission = await prisma.mission.findUnique({
    where: { id },
    include: {
      client: { select: { id: true, firstname: true, lastname: true, avatarPath: true, country: true, kycStatus: true, createdAt: true } },
      _count: { select: { proposals: true, engagements: { where: { status: { not: "annulee" } } } } },
      // Annonce et engagements (2026-11-10) : l'annonce d'origine d'un engagement, et les
      // engagements d'une annonce avec le prestataire retenu sur chacun.
      parentMission: { select: { id: true, titre: true } },
      engagements: {
        // Un engagement annulé (désistement, 2026-11-11) ne compte plus parmi les retenus.
        where: { status: { not: "annulee" } },
        select: {
          id: true,
          status: true,
          createdAt: true,
          proposals: { select: { provider: { select: { id: true, firstname: true, lastname: true, avatarPath: true } } }, take: 1 },
        },
        orderBy: { createdAt: "asc" },
      },
      // Uniquement pour dériver contractPrice / escrowHoldStatus côté serveur — jamais
      // renvoyés bruts (voir le return ci-dessous, où le termsSnapshot est retiré).
      contract: {
        select: {
          termsSnapshot: true,
          escrowOperations: { select: { instructionType: true, status: true, pspReference: true } },
          validationMode: true,
          siteManagerId: true,
          providerId: true,
        },
      },
    },
  });
  if (!mission) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Stats réelles du client (carte "Client" de /missions/[id]/devis) — note moyenne (Review,
  // targetId = client, même agrégat que public-profile) et missions clôturées EN TANT QUE
  // CLIENT (clientId, pas providerId — l'agrégat de public-profile compterait toujours 0
  // pour un client, il est provider-only).
  const [clientReviews, clientMissionsCompleted] = await Promise.all([
    prisma.review.findMany({ where: { targetId: mission.clientId, suspendu: false }, select: { note: true } }),
    prisma.mission.count({ where: { clientId: mission.clientId, status: "cloturee" } }),
  ]);
  const clientStats = {
    averageRating: clientReviews.length ? clientReviews.reduce((s, r) => s + r.note, 0) / clientReviews.length : null,
    missionsCompleted: clientMissionsCompleted,
    memberSince: mission.client?.createdAt ?? null,
    kycVerified: mission.client?.kycStatus === "verifie",
  };

  // Prix contractuel et statut du séquestre, dérivés CÔTÉ SERVEUR pour la page escrow. Le
  // client affiche le montant réellement séquestré (le prix du contrat = proposition
  // acceptée), pas le budget publié — et sait si une instruction HOLD est déjà en vol
  // (auto-déclenchée à la contre-signature) pour ne pas proposer un second paiement.
  const contract = mission.contract;
  const contractPriceVal = contract
    ? contractPrice({ mission, termsSnapshot: contract.termsSnapshot })
    : null;
  // Délai convenu = delaiJours figé dans le contrat (respecte delaiPropose de la
  // contre-proposition, sinon retombe sur mission.delaiJours) — pour que la page mission
  // affiche le délai réellement contracté dès que le contrat existe.
  const contractDelaiJours = (contract?.termsSnapshot as { delaiJours?: number } | null)?.delaiJours ?? null;
  const holdOp = contract?.escrowOperations.find((op) => op.instructionType === "hold");
  const escrowHoldStatus = holdOp?.status ?? null;
  // PSP virtuelle (développement uniquement) : référence du HOLD en attente, pour que la page
  // séquestre propose d'autoriser le paiement sur l'écran Mobile Money simulé. Jamais exposée
  // en production — le vrai PSP pilote son propre flux.
  const escrowHoldReference =
    holdOp?.status === "pending" && isVirtualPspEnabled() ? (holdOp.pspReference ?? null) : null;
  const { contract: _contract, engagements, ...missionRest } = mission;
  const isOwner = mission.clientId === userId;

  return NextResponse.json({
    ...missionRest,
    contractPrice: contractPriceVal,
    contractDelaiJours,
    escrowHoldStatus,
    escrowHoldReference,
    isOwner,
    // Places de l'annonce (2026-11-10, src/lib/mission-expiry.ts) — publiques : elles disent au
    // prestataire combien de profils le client cherche et combien il en a déjà retenus.
    placesRecherchees: placesRecherchees(mission),
    prestatairesRetenus: mission._count.engagements,
    // Qui a été retenu : réservé au client.
    engagements: isOwner
      ? engagements.map((e) => ({ id: e.id, status: e.status, createdAt: e.createdAt, provider: e.proposals[0]?.provider ?? null }))
      : undefined,
    // Mode OPR (2026-10-01) : le responsable de chantier désigné sur le CONTRAT ouvre la mission
    // dans sa vue de vérification. L'identifiant du responsable n'est pas exposé à tous.
    isSiteManager:
      !!contract && contract.validationMode === "opr" && !!contract.siteManagerId && contract.siteManagerId === userId,
    // Prestataire PARTIE au contrat (2026-11-11) — distinct d'un simple candidat ou visiteur.
    // Sert au bandeau de suivi : la médiation et l'avis ne sont proposés qu'aux deux parties,
    // seules admises par leurs routes. L'identifiant du prestataire n'est pas exposé pour autant.
    isContractProvider: !!contract && contract.providerId === userId,
    siteManagerId: mission.clientId === userId ? mission.siteManagerId : undefined,
    clientStats,
  });
}
