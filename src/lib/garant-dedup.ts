// US-1311 — un même numéro de garant/référence ne doit pas apparaître sur plus de N
// profils artisan/manœuvre distincts. Seuil de départ à affiner avec des données réelles.
const MAX_PROFILES_PER_GARANT_PHONE = 3;

export function isGarantPhoneOverused(distinctProfileCount: number): boolean {
  return distinctProfileCount >= MAX_PROFILES_PER_GARANT_PHONE;
}

export { MAX_PROFILES_PER_GARANT_PHONE };
