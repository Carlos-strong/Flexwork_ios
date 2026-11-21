// Désistement d'un prestataire retenu (2026-11-11).
//
// Un ENGAGEMENT (mission enfant d'une annonce, src/lib/accept-proposal.ts) peut être annulé tant
// que son contrat n'est pas signé par les deux parties : aucun fonds n'a alors été engagé (le
// séquestre ne se déclenche qu'à la contre-signature). Deux auteurs possibles :
//   - le PRESTATAIRE retenu se désiste ;
//   - le CLIENT retire le prestataire (il ne répond plus, ou s'est désisté hors plateforme).
// Un motif est exigé dans les deux cas.
//
// Effets, en une transaction conditionnée par le statut (une signature concurrente gagne) :
//   - l'engagement passe à `annulee` (date, motif, auteur) ;
//   - la candidature retenue passe à `annulee_definitive` — le prestataire est libéré de
//     l'exclusivité des négociations ;
//   - la place se libère sur l'annonce (PLACE_TAKING_ENGAGEMENT, src/lib/mission-expiry.ts) :
//     le client peut retenir un autre candidat, y compris de sa RÉSERVE après la clôture.
// L'autre partie est notifiée.
import { prisma } from "@/lib/db";
import { notifyMissionUser } from "@/lib/mission-notify";
import { isReserveOpen } from "@/lib/mission-expiry";
import { canWithdrawEngagement, favoritesAvailable, WITHDRAWABLE_ENGAGEMENT_STATUSES } from "@/lib/engagement-withdrawal-rules";

export { canWithdrawEngagement, favoritesAvailable, WITHDRAWABLE_ENGAGEMENT_STATUSES };

export type WithdrawActor = "client" | "prestataire";
export type WithdrawError = "not_found" | "not_engagement" | "not_withdrawable" | "reason_required" | "no_favorites";

export async function withdrawEngagement(opts: {
  engagementId: string;
  userId: string;
  reason: string;
}): Promise<{ ok: true; actor: WithdrawActor } | { ok: false; error: WithdrawError }> {
  const reason = opts.reason.trim();
  if (reason.length < 3) return { ok: false, error: "reason_required" };

  const e = await prisma.mission.findUnique({
    where: { id: opts.engagementId },
    select: {
      id: true,
      titre: true,
      status: true,
      clientId: true,
      parentMissionId: true,
      parentMission: { select: { id: true, titre: true, status: true, dateExpiration: true } },
      contract: { select: { clientSignedAt: true, providerSignedAt: true } },
      proposals: { where: { status: { in: ["acceptee", "devis_valide"] } }, select: { id: true, providerId: true }, take: 1 },
    },
  });
  if (!e) return { ok: false, error: "not_found" };
  const retained = e.proposals[0] ?? null;
  const actor: WithdrawActor | null = opts.userId === e.clientId ? "client" : retained && opts.userId === retained.providerId ? "prestataire" : null;
  // Un tiers ne distingue pas un engagement inexistant d'un engagement qui n'est pas le sien.
  if (!actor) return { ok: false, error: "not_found" };
  if (!e.parentMissionId) return { ok: false, error: "not_engagement" };
  if (!canWithdrawEngagement(e)) return { ok: false, error: "not_withdrawable" };
  // Le client ne change de prestataire que si un favori peut le remplacer (2026-11-11).
  if (actor === "client" && e.parentMission) {
    const favoris = await prisma.missionProposal.count({ where: { missionId: e.parentMission.id, status: "preselectionnee" } });
    if (!favoritesAvailable({ annonceStatus: e.parentMission.status, reserveOpen: isReserveOpen(e.parentMission), favoris })) {
      return { ok: false, error: "no_favorites" };
    }
  }

  const done = await prisma.$transaction(async (tx) => {
    const m = await tx.mission.updateMany({
      where: { id: e.id, status: { in: [...WITHDRAWABLE_ENGAGEMENT_STATUSES] } },
      data: { status: "annulee", annuleeAt: new Date(), annulationMotif: reason, annuleePar: actor },
    });
    if (m.count === 0) return false;
    // Une signature complète arrivée entre-temps l'emporte : on annule la transaction.
    const c = await tx.prestationContract.findUnique({ where: { missionId: e.id }, select: { clientSignedAt: true, providerSignedAt: true } });
    if (c?.clientSignedAt && c?.providerSignedAt) throw new Error("signed_concurrently");
    if (retained) {
      await tx.missionProposal.update({ where: { id: retained.id }, data: { status: "annulee_definitive" } });
    }
    return true;
  }).catch((err) => {
    if (err instanceof Error && err.message === "signed_concurrently") return false;
    throw err;
  });
  if (!done) return { ok: false, error: "not_withdrawable" };

  const annonce = e.parentMission;
  const reserveHint = annonce && (annonce.status === "publiee" || isReserveOpen(annonce))
    ? " Sa place est libérée : vous pouvez retenir un autre candidat depuis la page des candidatures."
    : " Sa place est libérée.";
  const notes = await Promise.allSettled(
    actor === "prestataire"
      ? [
          notifyMissionUser({
            missionId: annonce?.id ?? e.id,
            userId: e.clientId,
            type: "engagement_annule",
            message: `Le prestataire retenu s'est désisté de « ${e.titre} » (motif : ${reason}).${reserveHint}`,
            email: { subject: `Désistement — ${e.titre}`, text: `Le prestataire retenu s'est désisté de « ${e.titre} ». Motif : ${reason}.${reserveHint}` },
          }),
        ]
      : retained
        ? [
            notifyMissionUser({
              missionId: e.id,
              userId: retained.providerId,
              type: "engagement_annule",
              message: `Le client a retiré votre engagement sur « ${e.titre} » (motif : ${reason}). Aucun contrat n'avait été signé par les deux parties.`,
              email: { subject: `Engagement annulé — ${e.titre}`, text: `Le client a retiré votre engagement sur « ${e.titre} ». Motif : ${reason}. Vous êtes libre de candidater à d'autres missions.` },
            }),
          ]
        : []
  );
  for (const n of notes) if (n.status === "rejected") console.error("[engagement-withdrawal] notification :", n.reason);
  return { ok: true, actor };
}
