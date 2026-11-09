// Drapeau d'un pays (code ISO 3166-1 alpha-2) en emoji — « BJ » → 🇧🇯, 🌍 si code absent ou
// invalide. Fonction pure, sans état : utilisable côté serveur (cartes de l'accueil) comme côté
// client (PersonCard, propositions, devis).
export function countryFlag(code?: string | null): string {
  if (!code || !/^[A-Za-z]{2}$/.test(code)) return "🌍";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}
