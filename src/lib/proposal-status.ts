// Règle d'affichage partagée d'une candidature en cours de négociation (2026-09-09).
//
// Une demande de révision (POST .../proposals/[proposalId]/devis/request-revision) ne change
// PAS MissionProposal.status : elle pose seulement `revisionRequestedAt`. Les vues doivent
// donc combiner les deux champs pour ne pas rester figées sur « Envoyée / Reçue / En
// négociation » alors qu'une nouvelle version est attendue.
//
// Cette règle vivait dupliquée dans trois vues (page /missions/[id]/proposals, « Mes
// candidatures » prestataire, « Propositions » client), avec des replis déjà divergents.
// Elle est centralisée ici : chaque vue garde son vocabulaire (« Envoyée » vs « Reçue »,
// libellés d'avancement de mission) mais partage la MÊME condition.

// Statuts terminaux : la négociation est close, plus aucune révision n'est attendue.
// `devis_valide` en fait partie — la suite est la génération du contrat, pas une resoumission.
export const TERMINAL_PROPOSAL_STATUSES = ["acceptee", "devis_valide", "refusee", "annulee_definitive"] as const;

export const REVISION_REQUESTED_LABEL = "Révision demandée";

// Classe Tailwind du badge « Révision demandée » (violet), commune aux vues qui composent
// leurs classes à la main.
export const REVISION_REQUESTED_BADGE = "bg-[#EDE9FE] text-[#6D28D9] border border-[#DDD6FE]";

export function isTerminalProposalStatus(status: string): boolean {
  return (TERMINAL_PROPOSAL_STATUSES as readonly string[]).includes(status);
}

/**
 * Une révision est-elle réellement en attente ?
 *
 * Le statut terminal PRIME sur le drapeau : le client peut demander une révision à un
 * candidat puis en retenir un autre — la candidature passe alors à `refusee` (ou `acceptee`
 * s'il l'accepte quand même) sans que `revisionRequestedAt` soit remis à null par les
 * transitions historiques. Sans cette précédence, une candidature perdue continuait
 * d'afficher « Révision demandée » et invitait le prestataire à resoumettre dans le vide.
 * Les routes de transition nettoient désormais le champ ; cette garde reste la ceinture pour
 * les lignes déjà en base avant le correctif.
 */
export function isRevisionPending(p: { status: string; revisionRequestedAt?: string | Date | null }): boolean {
  return !!p.revisionRequestedAt && !isTerminalProposalStatus(p.status);
}
