// Libellés et helpers d'affichage d'un prestataire, partagés entre /recherche (résultats de
// recherche) et la page d'accueil publique (section « Talents »). Extrait de
// src/app/recherche/page.tsx : les deux écrans rendent la même PersonCard à partir des mêmes
// champs, et la règle « pas d'email en repli » doit valoir aux deux endroits — la route
// publique /api/search/prestataires ne renvoie plus d'email du tout.

export const PROVIDER_ROLE_LABEL: Record<string, string> = {
  expert_digital: "Expert Digital",
  expert_btp_autres: "Expert BTP / Autres",
  artisan: "Artisan",
  manoeuvre: "Manœuvre",
  responsable_chantier: "Responsable chantier",
};

/** Champs d'identité minimaux nécessaires à l'affichage d'une carte. */
export type ProviderIdentity = {
  firstname: string | null;
  lastname: string | null;
};

/** Nom affiché. Repli neutre — jamais l'email, qui n'est pas une donnée publique. */
export function providerDisplayName(p: ProviderIdentity): string {
  return [p.firstname, p.lastname].filter(Boolean).join(" ") || "Prestataire";
}

/** Initiales pour l'avatar de repli, « ? » si aucun nom n'est renseigné. */
export function providerInitials(p: ProviderIdentity): string {
  const a = p.firstname?.trim()?.charAt(0) ?? "";
  const b = p.lastname?.trim()?.charAt(0) ?? "";
  return `${a}${b}`.toUpperCase() || "?";
}

/** Ligne « 4 550 FCFA / heure », null si aucun tarif indicatif déclaré — jamais inventé. */
export function providerPriceLabel(
  indicativeRate: number | null,
  tarifUnite: string | null,
): string | null {
  if (!indicativeRate) return null;
  return `${indicativeRate.toLocaleString("fr-FR")} FCFA${tarifUnite ? ` / ${tarifUnite}` : ""}`;
}
