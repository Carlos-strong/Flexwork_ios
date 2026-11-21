import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { ACCEPTABLE_PROPOSAL_STATUSES, acceptProposal } from "@/lib/accept-proposal";
import { assertNoSelfDealing } from "@/lib/invariants";
import { isOpenForApplications, isReserveOpen } from "@/lib/mission-expiry";
import { kycBlockFor } from "@/lib/kyc-policy";

// Phase 4 : le client RETIENT un prestataire sur son annonce (2026-11-10) — un engagement est
// créé pour lui (src/lib/accept-proposal.ts), dans la limite des places recherchées. L'annonce
// reste ouverte jusqu'à sa date limite ; les autres candidatures ne sont pas refusées. Ne génère
// pas encore le contrat (voir /contract, US-402, appelé sur l'ENGAGEMENT renvoyé).
//
// Ordre des contrôles (2026-11-10), du plus général au plus spécifique :
//   401 non connecté → 404 mission/candidature introuvable ou pas à lui (indistinguables) →
//   403 auto-attribution → 409 mode devis (passe par .../devis/validate) → 403 KYC du client →
//   409 état (annonce close, candidature close, places pourvues) — revérifié À L'ÉCRITURE par
//   acceptProposal, sous verrou : deux sélections simultanées ne dépassent pas les places.
// Le KYC venait avant la propriété de la mission : un compte non vérifié recevait 403
// « vérifiez votre identité » sur la mission de n'importe qui, au lieu de 404.
const STATE_MESSAGES: Record<string, string> = {
  mission_not_open: "La période de candidature de cette mission est terminée.",
  proposal_not_acceptable: "Cette candidature n'est plus ouverte : elle a déjà été retenue ou refusée.",
  places_full: "Vous avez déjà retenu le nombre de prestataires recherchés pour cette mission.",
};

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; proposalId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, proposalId } = await params;

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission || mission.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const proposal = await prisma.missionProposal.findUnique({ where: { id: proposalId } });
  if (!proposal || proposal.missionId !== missionId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Famille 4 — invariant : le client ne peut pas accepter SA propre candidature.
  if (!assertNoSelfDealing(userId, proposal.providerId)) {
    return NextResponse.json({ error: "self_dealing_forbidden" }, { status: 403 });
  }
  // Mode devis : la sélection passe par la validation du devis, qui vérifie qu'un devis existe
  // et qu'il est en négociation. L'accepter ici retenait un prestataire sans devis validé.
  if (mission.budgetType === "QUOTE") {
    return NextResponse.json(
      { error: "quote_mission", message: "Mission sur devis : validez le devis du prestataire pour le retenir." },
      { status: 409 }
    );
  }

  // Retenir un prestataire engage le client : identité vérifiée exigée (src/lib/kyc-policy.ts).
  const kycBlock = await kycBlockFor(userId, "contractualiser");
  if (kycBlock) {
    return NextResponse.json(kycBlock, { status: 403 });
  }

  // Pré-contrôle lisible (la garde qui fait foi est dans acceptProposal, à l'écriture). Après la
  // clôture, un candidat de la RÉSERVE (présélectionné) peut encore être retenu tant qu'elle
  // court (2026-11-11, src/lib/mission-expiry.ts).
  const fromReserve = proposal.status === "preselectionnee" && isReserveOpen(mission);
  if (mission.parentMissionId !== null || !(isOpenForApplications(mission) || fromReserve)) {
    return NextResponse.json({ error: "mission_not_open", message: STATE_MESSAGES.mission_not_open }, { status: 409 });
  }
  if (!(ACCEPTABLE_PROPOSAL_STATUSES as readonly string[]).includes(proposal.status)) {
    return NextResponse.json(
      { error: "proposal_not_acceptable", message: STATE_MESSAGES.proposal_not_acceptable },
      { status: 409 }
    );
  }

  const result = await acceptProposal(missionId, proposalId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error, message: STATE_MESSAGES[result.error] }, { status: 409 });
  }

  // `engagementId` : la mission où se poursuit le parcours (contrat, signature, séquestre).
  return NextResponse.json({ ok: true, engagementId: result.engagementId });
}
