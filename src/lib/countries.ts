// Source unique pays ⇄ indicatif téléphonique.
//
// Extrait de src/app/signup/page.tsx (2026-09-23), où le commentaire d'origine notait déjà
// que deux listes divergentes avaient laissé NG absent des pays et BF/NE absents des
// indicatifs. Le profil client édite les mêmes champs que l'inscription : il lit la même
// liste plutôt que d'en recopier une troisième.
export type Country = {
  code: string;
  dial: string;
  flag: string;
  name: string;
};

export const COUNTRIES: readonly Country[] = [
  { code: "BJ", dial: "+229", flag: "🇧🇯", name: "Bénin" },
  { code: "TG", dial: "+228", flag: "🇹🇬", name: "Togo" },
  { code: "SN", dial: "+221", flag: "🇸🇳", name: "Sénégal" },
  { code: "CI", dial: "+225", flag: "🇨🇮", name: "Côte d'Ivoire" },
  { code: "BF", dial: "+226", flag: "🇧🇫", name: "Burkina Faso" },
  { code: "NE", dial: "+227", flag: "🇳🇪", name: "Niger" },
  { code: "NG", dial: "+234", flag: "🇳🇬", name: "Nigeria" },
];

export const DEFAULT_COUNTRY = COUNTRIES[0];

export function countryByCode(code: string | null | undefined): Country | undefined {
  return COUNTRIES.find((c) => c.code === code);
}
