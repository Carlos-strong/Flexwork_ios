// Règles pures du désistement (2026-11-11) — sans dépendance serveur, pour être partagées par
// la route (src/lib/engagement-withdrawal.ts) et les écrans (cartes des retenus, panneau du
// prestataire).

/** Statuts d'un engagement encore annulable : avant toute signature complète du contrat. */
export const WITHDRAWABLE_ENGAGEMENT_STATUSES = ["proposition_acceptee", "contrat_genere"] as const;

/** Règle pure : l'engagement peut-il encore être annulé ? */
export function canWithdrawEngagement(e: {
  parentMissionId: string | null;
  status: string;
  contract: { clientSignedAt: Date | string | null; providerSignedAt: Date | string | null } | null;
}): boolean {
  if (!e.parentMissionId) return false;
  if (!(WITHDRAWABLE_ENGAGEMENT_STATUSES as readonly string[]).includes(e.status)) return false;
  return !(e.contract?.clientSignedAt && e.contract?.providerSignedAt);
}

/**
 * « Changer ce prestataire » (côté CLIENT, 2026-11-11) : permis si et seulement si un FAVORI
 * est disponible pour le remplacer — un candidat présélectionné sur l'annonce, tant qu'elle
 * reçoit des candidatures ou que sa réserve court (src/lib/mission-expiry.ts). Le désistement du
 * PRESTATAIRE, lui, n'est jamais conditionné.
 */
export function favoritesAvailable(input: { annonceStatus: string; reserveOpen: boolean; favoris: number }): boolean {
  if (input.favoris <= 0) return false;
  return input.annonceStatus === "publiee" || (input.annonceStatus === "annonce_close" && input.reserveOpen);
}
