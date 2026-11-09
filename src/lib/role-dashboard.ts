// Mappe le rôle utilisateur vers son tableau de bord — était dupliqué à l'identique dans
// src/components/nav.tsx et src/app/verify-otp/page.tsx.
export type Role =
  | "client"
  | "expert_digital"
  | "expert_btp_autres"
  | "artisan"
  | "manoeuvre"
  | "responsable_chantier"
  | "admin";

export const ROLE_DASHBOARD: Record<string, string> = {
  // Namespace /client/* — mêmes URLs que la sidebar (CLIENT_NAV, DashboardLayout.tsx) et
  // que missionsHrefForRole ci-dessous. `/dashboard/client` reste servi (redirection, voir
  // src/app/dashboard/client/page.tsx) pour les liens historiques, mais n'est plus la cible
  // canonique — ça évitait un aller-retour de redirection à chaque connexion.
  client: "/client/dashboard",
  expert_digital: "/dashboard/expert-digital",
  expert_btp_autres: "/dashboard/expert-btp",
  artisan: "/dashboard/artisan",
  manoeuvre: "/dashboard/manoeuvre",
  // Le responsable de chantier n'est pas un prestataire : son tableau de bord ne porte ni
  // missions disponibles, ni candidatures, ni wallet — seulement les chantiers où un client
  // l'a désigné (voir SiteManagerDashboard).
  responsable_chantier: "/dashboard/responsable-chantier",
  admin: "/admin",
};

// L'affichage de toutes les missions se fait désormais UNIQUEMENT dans le dashboard
// (section "Mes Missions" du prestataire, /client/missions pour le client). Les pages
// autonomes /missions et /missions/<role> ont été supprimées — ce helper donne le lien
// valide vers la liste de missions du rôle, et le point d'entrée de connexion sinon.
export function missionsHrefForRole(role: Role | undefined): string {
  if (!role) return "/signin";
  if (role === "client") return "/client/missions";
  const dash = ROLE_DASHBOARD[role];
  if (dash?.startsWith("/dashboard/")) return `${dash}/missions`;
  return "/signin";
}

// Lien vers "Mes candidatures" (uniquement les rôles prestataire — un client ne candidate
// jamais, il n'y a donc pas d'équivalent "candidatures" pour ce rôle : /dashboard/client
// n'a pas cette section, contrairement aux dashboards prestataire) — utilisé pour rediriger
// après la soumission d'un devis (voir DevisForm). En pratique jamais appelé avec
// role === "client" (DevisPanel ne rend le formulaire que côté prestataire), mais on ne
// laisse pas ce cas produire un lien mort pour autant.
export function candidaturesHrefForRole(role: Role | undefined): string {
  if (!role || role === "client") return "/signin";
  const dash = ROLE_DASHBOARD[role];
  if (dash?.startsWith("/dashboard/")) return `${dash}/candidatures`;
  return "/signin";
}

// Filières chantier (etat-consolide-Flexwork.md §2, A9/A13) : assurance effective
// bloquante sur risque élevé. L'OPTION garant (1 obligatoire + 2 optionnels) reste
// disponible pour ces filières, mais est désactivée PAR DÉFAUT : elle ne s'applique que si
// l'Admin KYC a activé « garant requis » pour le compte (User.garantRequired, 2026-09-09).
export const CHANTIER_ROLES = ["artisan", "manoeuvre", "expert_btp_autres"] as const;
export const GARANT_ROLES = CHANTIER_ROLES;
