import { LayoutDashboard, Briefcase, MessageSquare, Heart, FileText, Wallet, Star, Handshake, Sparkles, UserRound, HardHat, Users } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { providerUrl } from "@/lib/provider-urls";
import { ROLE_DASHBOARD } from "@/lib/role-dashboard";

// Navigation de l'espace connecté, par rôle (2026-11-09). Ces listes alimentaient le sidebar
// des tableaux de bord ; le sidebar a été déplacé dans le menu du profil de la barre de
// navigation globale (src/components/ProfileMenu.tsx). Elles vivent donc ici, sans dépendance
// vers un tableau de bord entier.

/** Rubrique de navigation de l'espace connecté. */
export type NavItem = {
  id: string;
  label: string;
  Icon: LucideIcon;
  href?: string;
};

/** Identité affichée par un tableau de bord (fil d'Ariane, en-têtes de rubrique). */
export type DashboardUser = {
  /** Id du compte connecté. */
  id?: string | null;
  initials: string;
  name: string;
  /** Libellé du rôle — premier maillon du fil d'Ariane. */
  role: string;
  avatarGradient: string;
  /** Photo de profil (/api/users/[id]/avatar) ; absente, on retombe sur les initiales. */
  avatarUrl?: string | null;
};

// Les badges ne sont plus statiques ici : ils sont alimentés par les compteurs réels
// calculés dans useSidebarBadges (événements : messages, propositions, paiements).
// Aucun `badge` codé en dur — seul badgeCounts (dynamique) s'affiche.
// NB : pas de rubrique "Notifications" dans le sidebar — les notifications in-app sont
// portées par la cloche du navbar (NotificationsBell), synchronisée par utilisateur.
export const CLIENT_NAV: NavItem[] = [
  { id: "dashboard", label: "Tableau de bord", Icon: LayoutDashboard, href: "/client/dashboard" },
  { id: "missions", label: "Mes Missions", Icon: Briefcase, href: "/client/missions" },
  { id: "messages", label: "Messages", Icon: MessageSquare, href: "/client/messages" },
  { id: "propositions", label: "Propositions", Icon: FileText, href: "/client/propositions" },
  // Pendant client de la rubrique Offres du prestataire : catalogue des Gigs + commandes
  // (achat et signature 1/2). Remplace les pages autonomes /gigs* supprimees.
  { id: "offres", label: "Offres", Icon: Handshake, href: "/client/offres" },
  { id: "paiements", label: "Paiements", Icon: Wallet, href: "/client/paiements" },
  { id: "favoris", label: "Favoris", Icon: Heart, href: "/recherche" },
  // `profil` est ABSENT à dessein : le client a /profile/client, atteint par la carte de
  // complétion et par le menu utilisateur. L'entrée ci-dessous (« Option C ») est une ACTION
  // de compte — elle a sa place dans la navigation.
  //
  // Le libellé est « Espace prestataire » et non « Devenir prestataire » : la navigation est
  // statique et sert aussi un compte DÉJÀ prestataire qui navigue côté client (un prestataire
  // achète aussi des missions). « Devenir » afficherait une promesse fausse à celui qui l'est
  // déjà ; « Espace » reste exact dans les deux cas — la page, elle, s'adapte (activation ou
  // redirection vers /profile).
  { id: "devenir-prestataire", label: "Espace prestataire", Icon: Sparkles, href: "/devenir-prestataire" },
];

// Navigation prestataire, pilotée par URL : chaque rubrique a une URL réelle dérivée du
// rôle (voir src/lib/provider-urls.ts). `dashboard` reste le point d'entrée (base), les
// autres sections pointent vers /dashboard/{slug}/{section}.
export const providerNav = (role: string): NavItem[] => [
  { id: "dashboard", label: "Tableau de bord", Icon: LayoutDashboard, href: providerUrl(role, "dashboard") },
  { id: "missions", label: "Missions disponibles", Icon: Briefcase, href: providerUrl(role, "missions") },
  { id: "messages", label: "Messages", Icon: MessageSquare, href: providerUrl(role, "messages") },
  { id: "candidatures", label: "Mes candidatures", Icon: FileText, href: providerUrl(role, "candidatures") },
  { id: "offres", label: "Offres", Icon: Handshake, href: providerUrl(role, "offres") },
  { id: "wallet", label: "Wallet", Icon: Wallet, href: providerUrl(role, "wallet") },
  // « Mon profil » était la rubrique MANQUANTE du sidebar prestataire (2026-09-23) : le
  // formulaire existait, mais aucun lien n'y menait — il fallait connaître l'URL. Le badge et
  // le compte de versement, eux, s'atteignent depuis la carte de complétion du tableau de bord.
  { id: "profil", label: "Mon profil", Icon: UserRound, href: "/profile" },
  { id: "favoris", label: "Favoris", Icon: Star, href: providerUrl(role, "favoris") },
];

// Responsable de chantier : trois rubriques, pas sept. (L'icône de « Messages » était un
// portefeuille — corrigée.)
export const SITE_MANAGER_NAV: NavItem[] = [
  { id: "dashboard", label: "Mes chantiers", Icon: HardHat, href: "/dashboard/responsable-chantier" },
  { id: "equipe", label: "Équipe", Icon: Users, href: "/dashboard/responsable-chantier/equipe" },
  { id: "messages", label: "Messages", Icon: MessageSquare, href: "/dashboard/responsable-chantier/messages" },
];

export type AccountNav = {
  /** Mode des compteurs (useSidebarBadges). */
  mode: "client" | "prestataire" | null;
  items: NavItem[];
  /** Rubrique « Devis & Contrats » (absente pour le responsable de chantier). */
  documentsBase: string | null;
  /** Formulaire du profil. */
  profileEditHref: string;
};

/** Navigation du compte connecté selon son rôle. */
export function accountNavFor(role: string | undefined | null): AccountNav {
  if (role === "responsable_chantier") {
    return { mode: null, items: SITE_MANAGER_NAV, documentsBase: null, profileEditHref: "/profile/client" };
  }
  const dash = role ? ROLE_DASHBOARD[role] : undefined;
  if (dash?.startsWith("/dashboard/")) {
    const slug = dash.slice("/dashboard/".length);
    return { mode: "prestataire", items: providerNav(slug), documentsBase: `${dash}/devis-contrats`, profileEditHref: "/profile" };
  }
  return { mode: "client", items: CLIENT_NAV, documentsBase: "/client/devis-contrats", profileEditHref: "/profile/client" };
}

/**
 * Page des brouillons (Devis & Contrats › Brouillons) après une candidature retenue faute de
 * KYC vérifié : `?envoi=en-attente&mission=` y affiche l'avertissement de non-envoi.
 */
export function heldCandidatureHref(role: string | undefined | null, missionId: string): string {
  const base = accountNavFor(role).documentsBase ?? "/client/devis-contrats";
  return `${base}?tab=devis&f=brouillons&envoi=en-attente&mission=${encodeURIComponent(missionId)}`;
}
