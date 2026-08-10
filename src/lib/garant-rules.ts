// etat-consolide-Flexwork.md §1.3 : "Personnes ressources pour Artisan et Manœuvre
// (1 obligatoire + 2 optionnelles)" — remplace l'ancienne règle "2 garants obligatoires".
export const GARANTS_OBLIGATOIRES = 1;
export const GARANTS_MAX = 3; // 1 obligatoire + 2 optionnelles

export function hasRequiredGarants(garants: { obligatoire: boolean }[]): boolean {
  return garants.filter((g) => g.obligatoire).length >= GARANTS_OBLIGATOIRES;
}

export function canAddGarant(currentCount: number): boolean {
  return currentCount < GARANTS_MAX;
}
