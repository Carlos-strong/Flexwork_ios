import type { Mission, Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isOpenForApplications } from "@/lib/mission-expiry";

// Candidatures retenues faute de KYC vérifié (2026-11-09).
//
// Préparer sa candidature est libre, l'ENVOYER exige une identité vérifiée
// (src/lib/kyc-policy.ts). Jusqu'ici, un prestataire non vérifié qui cliquait « Envoyer »
// recevait un refus et perdait sa saisie. Désormais la route de candidature enregistre la
// requête — déjà validée par son schéma — dans ProposalDraft, et répond toujours 403
// `kyc_not_verified`, avec `draftSaved: true`.
//
// Le prestataire ne valide sa candidature QU'UNE FOIS : à la validation de son KYC, elle part
// d'elle-même au client (sendPendingApplications, src/lib/candidature-submit.ts), avec tous les
// contrôles d'un envoi normal. Jusque-là, il peut la modifier — un nouvel envoi remplace le
// brouillon — ou la supprimer. Un envoi automatique refusé pour une raison CORRIGEABLE (garant
// manquant, assurance…) laisse le brouillon en place avec sa raison (`lastError`), à corriger
// puis envoyer ; un refus DÉFINITIF (mission complète, fermée, attribuée) le retire, et le
// prestataire en est prévenu (2026-11-10). La clôture d'une annonce à son échéance retire les
// brouillons restants (closeMissionDrafts, src/lib/proposal-drafts-close.ts).

export type ProposalDraftKind = "proposal" | "devis";

/** Route d'envoi d'une candidature selon son type. */
export function proposalDraftEndpoint(kind: ProposalDraftKind, missionId: string): string {
  return `/api/missions/${missionId}/${kind === "devis" ? "devis" : "proposals"}`;
}

type HoldResult =
  | { held: false; providerId: string }
  | { held: false; providerId: null; response: { status: 401; body: { error: "unauthenticated" } } }
  | { held: true; status: 403; body: { error: "kyc_not_verified"; message: string; draftSaved: boolean } };

/**
 * Garde KYC des routes de candidature. Compte vérifié → `{ held: false, providerId }`, la
 * route continue. Sinon, la candidature est mise en brouillon si elle peut l'être — mission
 * publiée et ouverte, pas la sienne, aucune candidature déjà envoyée, corps valide — et la
 * route renvoie `body` avec `status`.
 */
export async function holdCandidatureForKyc(opts: {
  kind: ProposalDraftKind;
  mission: Pick<Mission, "id" | "clientId" | "status" | "dateExpiration"> | null;
  /** Corps déjà lu et validé par le schéma de la route ; `null` s'il est invalide. */
  payload: Prisma.InputJsonValue | null;
}): Promise<HoldResult> {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return { held: false, providerId: null, response: { status: 401, body: { error: "unauthenticated" } } };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } });
  if (user?.kycStatus === "verifie") return { held: false, providerId: userId };

  const m = opts.mission;
  const open = !!m && isOpenForApplications(m);
  let draftSaved = false;
  if (m && open && m.clientId !== userId && opts.payload !== null) {
    // Déjà candidat sur l'annonce, ou déjà retenu (candidature passée sur son engagement).
    const sent = await prisma.missionProposal.findFirst({
      where: { providerId: userId, OR: [{ missionId: m.id }, { mission: { parentMissionId: m.id } }] },
      select: { id: true },
    });
    if (!sent) {
      await prisma.proposalDraft.upsert({
        where: { missionId_providerId: { missionId: m.id, providerId: userId } },
        create: { missionId: m.id, providerId: userId, kind: opts.kind, payload: opts.payload },
        // Modification : l'échec d'un envoi précédent ne vaut plus pour la nouvelle version.
        update: { kind: opts.kind, payload: opts.payload, lastError: null },
      });
      draftSaved = true;
    }
  }
  return {
    held: true,
    status: 403,
    body: {
      error: "kyc_not_verified",
      message: draftSaved
        ? "Votre candidature est enregistrée : elle sera envoyée automatiquement au client dès que votre identité sera vérifiée. Vous pouvez la modifier d'ici là."
        : "Votre identité doit être vérifiée avant de candidater.",
      draftSaved,
    },
  };
}

/** Candidature envoyée : son brouillon n'a plus lieu d'être. */
export async function deleteProposalDraft(missionId: string, providerId: string): Promise<void> {
  await prisma.proposalDraft.deleteMany({ where: { missionId, providerId } });
}
