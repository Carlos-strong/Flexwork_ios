// Source unique de vérité des URLs du dashboard prestataire.
//
// Même pattern que le dashboard client (déjà piloté par URL via des pages wrapper +
// `goTo(id)` = router.push) : chaque rubrique du sidebar a une URL réelle
// `/dashboard/{role}/{section}`. Auparavant, les sections prestataire dépendaient d'un état
// client seul — le wallet pointait même vers `/dashboard/expert-digital` (le dashboard
// lui-même) et Messages/Candidatures n'avaient aucune URL.

// Slugs d'URL des rôles prestataire (correspondent aux dossiers src/app/dashboard/<slug>).
export const PROVIDER_ROLE_SLUGS = ["expert-digital", "expert-btp", "artisan", "manoeuvre"] as const;
export type ProviderRoleSlug = (typeof PROVIDER_ROLE_SLUGS)[number];

// Rôle en base (UserRole) -> slug d'URL.
export const ROLE_TO_SLUG: Record<string, ProviderRoleSlug> = {
  expert_digital: "expert-digital",
  expert_btp_autres: "expert-btp",
  artisan: "artisan",
  manoeuvre: "manoeuvre",
};

// Sections du sidebar prestataire (clés NavItem.id) — voir providerNav dans DashboardLayout.
export const PROVIDER_SECTIONS = [
  "dashboard",
  "missions",
  "messages",
  "candidatures",
  "offres",
  "devis-contrats",
  "wallet",
  "favoris",
] as const;
export type ProviderSection = (typeof PROVIDER_SECTIONS)[number];

export function isValidProviderSection(section: string): section is ProviderSection {
  return (PROVIDER_SECTIONS as readonly string[]).includes(section);
}

/**
 * URL d'une section pour un rôle donné.
 * - `dashboard` -> la base `/dashboard/{slug}`
 * - `favoris`   -> `/recherche` (route existante, partagée)
 * - sinon       -> `/dashboard/{slug}/{section}`
 */
export function providerUrl(role: string, section: string): string {
  const slug = ROLE_TO_SLUG[role] ?? PROVIDER_ROLE_SLUGS[0];
  if (section === "dashboard") return `/dashboard/${slug}`;
  if (section === "favoris") return "/recherche";
  return `/dashboard/${slug}/${section}`;
}
