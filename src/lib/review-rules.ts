// Règles de chronologie et de ciblage des avis (audit du workflow, 2026-09-01, A-1).
//
// Un avis CONCLUT une relation contractuelle terminée : la route POST /api/missions/[id]/
// reviews acceptait pourtant un avis à n'importe quel statut (dès `publiee`), de la part de
// n'importe quel candidat (même refusé), vers n'importe quel targetId. L'interface ne
// proposait le lien qu'à la clôture — mais l'API est la seule frontière qui compte.
// Logique pure, testable sans Prisma (même convention que devis.ts / garant-rules.ts).

// `validee` inclus : la libération des fonds est instruite, la prestation est terminée —
// attendre le webhook de clôture pour autoriser l'avis ne protège rien de plus.
export const REVIEWABLE_MISSION_STATUSES = ["validee", "cloturee"] as const;

export function canReviewAtStatus(status: string): boolean {
  return (REVIEWABLE_MISSION_STATUSES as readonly string[]).includes(status);
}

// Statut d'une proposition qui fait de son porteur la partie RETENUE (relation acceptée) :
//   - prix fixe / taux → "acceptee" (accept-proposal.ts) ;
//   - mode devis (QUOTE) → "devis_valide" (devis/validate) — le devis gagnant ne passe
//     jamais par "acceptee", la route contrat le reconnaît déjà (contract/route.ts :
//     `status: { in: ["acceptee", "devis_valide"] }`). Sans cette seconde valeur, un avis
//     était impossible sur une mission à devis, même clôturée (403 invalid_target).
export const ACCEPTED_PROPOSAL_STATUSES = ["acceptee", "devis_valide"] as const;

// Ids des prestataires retenus pour une mission — source unique du ciblage des avis
// (l'ancien filtre `status === "acceptee"` était dupliqué dans la route).
export function retainedProviderIds(proposals: { status: string; providerId: string }[]): string[] {
  return proposals
    .filter((p) => (ACCEPTED_PROPOSAL_STATUSES as readonly string[]).includes(p.status))
    .map((p) => p.providerId);
}

// L'avis ne peut viser que L'AUTRE partie de la relation acceptée :
//   - le client note le prestataire retenu (proposition acceptée OU devis validé) ;
//   - le prestataire retenu note le client.
// Retourne la cible légitime pour cet auteur, ou null si l'auteur n'est pas partie à la
// relation (candidat refusé, tiers) — auquel cas aucun avis n'est possible.
export function legitimateReviewTarget(input: {
  authorId: string;
  clientId: string;
  acceptedProviderIds: string[];
}): string[] {
  if (input.authorId === input.clientId) return input.acceptedProviderIds;
  if (input.acceptedProviderIds.includes(input.authorId)) return [input.clientId];
  return [];
}
