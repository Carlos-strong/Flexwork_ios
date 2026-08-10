// Paiement fractionné optionnel par jalons (2026-08-06) — un contrat peut être décomposé
// en jalons dont les montants somment exactement au prix convenu (proposition acceptée).
// Toute la logique de validation vit ici pour être testée une seule fois et réutilisée par
// la génération de contrat (POST /api/missions/[id]/contract) et par les routes /jalons/*.

export type JalonInput = { titre: string; montant: number };

const EPSILON = 0.01; // tolérance flottant sur une somme de montants XOF

export function validateJalonsSum(jalons: JalonInput[], prixContrat: number): { ok: true } | { ok: false; error: string } {
  if (jalons.length === 0) {
    return { ok: false, error: "jalons_empty" };
  }
  if (jalons.some((j) => j.montant <= 0)) {
    return { ok: false, error: "jalon_montant_invalide" };
  }
  if (jalons.some((j) => j.titre.trim().length === 0)) {
    return { ok: false, error: "jalon_titre_requis" };
  }
  const total = jalons.reduce((sum, j) => sum + j.montant, 0);
  if (Math.abs(total - prixContrat) > EPSILON) {
    return { ok: false, error: "jalons_sum_mismatch" };
  }
  return { ok: true };
}

// Un jalon ne peut recevoir de livrable que s'il est financé (HOLD confirmé) — même règle
// que canAttachLivrable (src/lib/attachments.ts) mais au niveau du jalon plutôt que de la
// mission entière.
export function canSubmitJalonDeliverable(status: string): boolean {
  return status === "fonds_sous_sequestre" || status === "rejete";
}

// Un jalon ne peut être financé (HOLD) que s'il est encore à l'état initial.
export function canHoldJalon(status: string): boolean {
  return status === "en_attente";
}

// Le client ne peut valider/rejeter qu'un jalon dont le livrable a été soumis.
export function canDecideJalon(status: string): boolean {
  return status === "livrable_soumis";
}
