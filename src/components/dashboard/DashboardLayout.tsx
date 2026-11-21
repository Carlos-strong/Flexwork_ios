"use client";

import type { ReactNode } from "react";
import type { DashboardUser, NavItem } from "./nav";

export type { DashboardUser, NavItem } from "./nav";

// Gabarit des tableaux de bord (2026-11-09) — SANS sidebar ni barre propre.
//
// La navigation de l'espace connecté (rubriques, Devis & Contrats, déconnexion) a été
// déplacée dans le menu du PROFIL de la barre de navigation globale, montée une seule fois
// par le layout racine pour toutes les pages (src/components/SiteHeader.tsx,
// src/components/ProfileMenu.tsx). Ce gabarit ne garde que le fil d'Ariane de la rubrique et
// la zone de contenu.
//
// La rubrique active (`activeNav` parmi `navItems`) donne le libellé du fil d'Ariane quand la
// page passe le titre générique « Tableau de bord ».
//
// Hauteur : la zone de contenu défile seule sous la barre globale et le fil d'Ariane
// (--site-header-h, --dash-crumb-h dans globals.css) — la messagerie occupe toute la hauteur
// visible (.h-dash-content).
type Props = {
  user: DashboardUser;
  navItems: NavItem[];
  activeNav: string;
  title: string;
  /** Montant affiché à droite du fil d'Ariane (revenus du prestataire). */
  solde?: string;
  topAction?: ReactNode;
  children: ReactNode;
};

const EXTRA_SECTION_LABELS: Record<string, string> = { "devis-contrats": "Devis & Contrats" };

export default function DashboardLayout(p: Props) {
  const { user, navItems, activeNav, solde, title, topAction, children } = p;
  // Libellé de la rubrique : le titre passé par la page, sinon celui de la rubrique active.
  // « Devis & Contrats » n'est pas une rubrique de navItems (elle vit dans le groupe Documents
  // du menu du compte) : sans ce repli, son fil d'Ariane affichait « Tableau de bord ».
  const section =
    title === "Tableau de bord" ? (navItems.find((n) => n.id === activeNav)?.label ?? EXTRA_SECTION_LABELS[activeNav] ?? title) : title;
  const crumb = section.replace(/^Tableau de bord \/ /, "");

  // Mise en page (2026-11-09) : TOUTES les rubriques suivent le gabarit de « Mes
  // candidatures » — une colonne centrée de 1280 px max (.page-width). Le fil d'Ariane est
  // posé dans la MÊME colonne, avec les mêmes marges : « Prestataire indépendant › Mes
  // candidatures » s'aligne sur le bord gauche du contenu au lieu de rester collé au bord de
  // l'écran. Les deux zones réservent la même gouttière de barre de défilement, sinon la
  // barre de la zone de contenu décalait sa colonne de quelques pixels.
  return (
    <div className="h-[calc(100dvh-var(--site-header-h))] bg-[#F6F5FA] flex flex-col overflow-hidden">
      <div className="h-[var(--dash-crumb-h)] shrink-0 border-b border-gray-100/80 bg-white/60 px-4 md:px-6 overflow-hidden [scrollbar-gutter:stable]">
        <div className="page-width h-full flex items-center gap-3">
          <nav aria-label="Fil d'Ariane" className="flex items-center gap-2 min-w-0 text-[13px]">
            <span className="text-zinc-400 font-medium shrink-0">{user.role}</span>
            <svg aria-hidden className="w-4 h-4 text-zinc-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
            <span className="font-semibold text-[#191224] truncate" aria-current="page">{crumb}</span>
          </nav>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {solde && (
              <div className="hidden md:flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#4C1D95]/10 text-[#047857] text-[12px] font-semibold border border-[#4C1D95]/10">
                <span className="w-1.5 h-1.5 rounded-full bg-[#4C1D95]" />
                {solde} FCFA
              </div>
            )}
            {topAction}
          </div>
        </div>
      </div>
      <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable] p-4 md:p-6">
        <div className="page-width">{children}</div>
      </main>
    </div>
  );
}

// Listes de navigation par rôle : src/components/dashboard/nav.ts (2026-11-09) — elles
// alimentent désormais le menu du profil de la barre de navigation globale.
export { CLIENT_NAV, providerNav, SITE_MANAGER_NAV } from "./nav";
