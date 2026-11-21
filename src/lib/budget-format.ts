// Affichage d'un budget de mission et du montant d'une candidature — source unique
// (2026-11-09). Trois écrans le recopiaient ; « Mes candidatures » (prestataire) écrivait en
// dur « FCFA » après le montant proposé, quelle que soit la devise de la mission : une
// candidature sur une mission en EUR s'affichait en FCFA. La devise vient toujours ici de la
// mission.

/** Budget publié d'une mission ; « Sur devis » pour une demande de devis. */
export function formatBudget(budget: number, currency: string, budgetType: string | null): string {
  return budgetType === "QUOTE" ? "Sur devis" : `${budget.toLocaleString("fr-FR")} ${currency}`;
}

/** Montant d'une candidature : le montant proposé s'il existe, sinon le budget de la mission. */
export function formatProposalAmount(p: {
  montant: number;
  mission: { budget: number; currency: string; budgetType: string | null };
}): string {
  return p.montant > 0
    ? `${p.montant.toLocaleString("fr-FR")} ${p.mission.currency}`
    : formatBudget(p.mission.budget, p.mission.currency, p.mission.budgetType);
}
