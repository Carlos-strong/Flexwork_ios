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

// Comparaison de numéros de téléphone insensible aux espaces ("+229 96 12 34 56" vs
// "+22996123456") — ne reformate jamais la valeur stockée/affichée, sert uniquement à
// détecter les doublons.
export function normalizeTel(tel: string): string {
  return tel.replace(/\s+/g, "");
}

// Un même garant (numéro) ne doit pas être utilisé deux fois pour le même candidat —
// évite qu'une personne ressource ne compte plusieurs fois vers le quota (1 obligatoire +
// 2 optionnelles) sous des noms différents.
export function isDuplicateGarantTel(
  tel: string,
  existing: { id: string; tel: string }[],
  excludeId?: string
): boolean {
  const normalized = normalizeTel(tel);
  return existing.some((g) => g.id !== excludeId && normalizeTel(g.tel) === normalized);
}
