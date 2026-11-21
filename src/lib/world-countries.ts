import { COUNTRIES } from "@/lib/countries";

// Pays d'obtention d'un diplôme (2026-11-07). Plus large que COUNTRIES (les 7 pays ouverts à
// l'inscription) : un diplôme s'obtient aussi au Ghana, au Maroc ou en France. Codes ISO
// 3166-1 alpha-2 ; les NOMS viennent de `Intl.DisplayNames` (français), pas d'une liste tenue
// à la main.

const AFRICA = [
  "DZ", "AO", "BJ", "BW", "BF", "BI", "CV", "CM", "CF", "TD", "KM", "CG", "CD", "CI", "DJ", "EG",
  "GQ", "ER", "SZ", "ET", "GA", "GM", "GH", "GN", "GW", "KE", "LS", "LR", "LY", "MG", "MW", "ML",
  "MR", "MU", "MA", "MZ", "NA", "NE", "NG", "RW", "ST", "SN", "SC", "SL", "SO", "ZA", "SS", "SD",
  "TZ", "TG", "TN", "UG", "ZM", "ZW",
];
const ELSEWHERE = ["FR", "BE", "CH", "CA", "US", "GB", "DE", "ES", "IT", "PT", "NL", "TR", "RU", "CN", "IN", "AE", "SA", "LB", "BR", "CU"];

let names: Intl.DisplayNames | null = null;
function displayName(code: string): string {
  try {
    names ??= new Intl.DisplayNames(["fr"], { type: "region" });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

export type WorldCountry = { code: string; name: string };

/** Nom français d'un code pays (« GH » → « Ghana »), le code lui-même s'il est inconnu. */
export function countryName(code: string | null | undefined): string | null {
  if (!code) return null;
  return COUNTRIES.find((c) => c.code === code)?.name ?? displayName(code);
}

/**
 * Deux groupes : les pays de la plateforme (ordre de COUNTRIES), puis tous les autres par
 * ordre alphabétique français.
 */
export function diplomaCountryGroups(): { label: string; countries: WorldCountry[] }[] {
  const platform = COUNTRIES.map((c) => ({ code: c.code, name: c.name }));
  const taken = new Set(platform.map((c) => c.code));
  const others = [...AFRICA, ...ELSEWHERE]
    .filter((code) => !taken.has(code))
    .map((code) => ({ code, name: displayName(code) }))
    .sort((a, b) => a.name.localeCompare(b.name, "fr"));
  return [
    { label: "Pays de la plateforme", countries: platform },
    { label: "Autres pays", countries: others },
  ];
}
