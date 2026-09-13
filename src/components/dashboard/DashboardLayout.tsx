"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Search, LogOut, Menu, LayoutDashboard, Briefcase, MessageSquare, Heart, FileText, Wallet, Star, Handshake } from "lucide-react";
import DashboardSidebar, { type NavItem, type SidebarUser, type DocumentsBlock } from "./DashboardSidebar";
import { NotificationsBell } from "@/components/notifications-bell";
import { Avatar } from "@/components/avatar";
import { providerUrl } from "@/lib/provider-urls";
import { useDevisContratsBadges } from "./useDevisContratsBadges";

export type { NavItem } from "./DashboardSidebar";
export type DashboardUser = SidebarUser;

type Props = {
  mode: "client" | "prestataire";
  user: DashboardUser;
  navItems: NavItem[];
  activeNav: string;
  onNavChange: (id: string) => void;
  solde?: string;
  title: string;
  topAction?: ReactNode;
  children: ReactNode;
  /** Remplace les badges statiques par des valeurs dynamiques (ex: { messages: 2, propositions: 5 }) */
  badgeCounts?: Record<string, number>;
};

export default function DashboardLayout(p: Props) {
  const { mode, user, navItems, activeNav, onNavChange, solde, title, topAction, badgeCounts, children } = p;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Compteurs du bloc « Documents Contractuels » — calculés ici une seule fois, pour toutes
  // les pages qui montent DashboardLayout (client et prestataire), plutôt que dans chacun
  // des ~10 points d'appel (R03 : ne pas dupliquer). La base de la rubrique « Devis &
  // Contrats » se déduit de l'URL du dashboard déjà présente dans navItems — /client/devis-
  // contrats pour le client (route dédiée, pas de sous-chemin du dashboard), /dashboard/
  // {role}/devis-contrats pour un prestataire (déjà une section valide, voir
  // src/lib/provider-urls.ts).
  const counts = useDevisContratsBadges();
  const dashboardHref = navItems.find((n) => n.id === "dashboard")?.href ?? "/client/dashboard";
  const documentsBase = mode === "client" ? "/client/devis-contrats" : `${dashboardHref}/devis-contrats`;
  const documents: DocumentsBlock = {
    base: documentsBase,
    devis: [
      { id: "brouillons", label: "Brouillons", count: counts.brouillon },
      { id: "negociation", label: "En négociation", count: counts.negociation },
      { id: "valides", label: "Validés", count: counts.valide },
      { id: "rejetes", label: "Rejetés", count: counts.rejete },
    ],
    contrats: [
      { id: "en-cours", label: "En cours", count: counts.enCours },
      { id: "clotures", label: "Clôturés", count: counts.cloture },
    ],
  };

  return (
    <div className="h-screen bg-[#FFF8F0] flex overflow-hidden">
      <DashboardSidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        sections={[{ id: "main", items: navItems }]}
        activeId={activeNav}
        onSelect={onNavChange}
        user={user}
        badgeCounts={badgeCounts}
        footerActions={[{ id: "logout", label: "Déconnexion", Icon: LogOut, href: "/signin" }]}
        documents={documents}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 h-[68px] bg-white/95 backdrop-blur-xl border-b border-gray-100/60 flex items-center gap-4 px-4 md:px-6 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button onClick={() => setSidebarOpen(true)} className="lg:hidden w-9 h-9 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-center hover:bg-gray-100 transition-colors shrink-0"><Menu className="w-4 h-4 text-zinc-600" /></button>
            <div className="hidden sm:flex items-center gap-2 min-w-0">
              <span className="text-[13px] text-zinc-400 font-medium">Tableau de bord</span>
              <svg className="w-4 h-4 text-zinc-300 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              <span className="text-[14px] font-semibold text-[#0A1931] truncate">{title === "Tableau de bord" ? user.role : title}</span>
            </div>
          </div>
          <div className="hidden lg:flex flex-1 max-w-[420px] mx-auto">
            <div className="relative w-full group">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 group-focus-within:text-[#FF7A00] transition-colors" />
              <input type="text" placeholder={mode === "client" ? "Rechercher un talent, une mission..." : "Rechercher une mission..."} className="w-full h-10 pl-10 pr-4 rounded-full bg-gray-50 border border-gray-100 text-[13px] placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#FF7A00]/20 focus:border-[#FF7A00] focus:bg-white transition-all" />
            </div>
          </div>
          <div className="flex items-center gap-1.5 md:gap-2 shrink-0">
            <button className="lg:hidden w-9 h-9 rounded-full bg-gray-50 border border-gray-100 flex items-center justify-center hover:bg-gray-100 transition-colors"><Search className="w-4 h-4 text-zinc-500" /></button>
            {solde && <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#008751]/10 text-[#008751] text-[12px] font-semibold border border-[#008751]/10"><span className="w-1.5 h-1.5 rounded-full bg-[#008751] animate-pulse" />{solde} FCFA</div>}
            <NotificationsBell />
            {topAction}
            <div className="hidden md:flex items-center gap-2.5 pl-2 ml-1 border-l border-gray-100">
              {user.id ? (
                <Link href={`/profil/${user.id}`} title="Voir mon profil">
                  <Avatar src={user.avatarUrl} initials={user.initials} gradient={user.avatarGradient} size={32} className="ring-2 ring-white shadow-sm hover:opacity-80 transition" />
                </Link>
              ) : (
                <Avatar src={user.avatarUrl} initials={user.initials} gradient={user.avatarGradient} size={32} className="ring-2 ring-white shadow-sm" />
              )}
              <div className="hidden lg:block text-right leading-tight"><div className="text-[12px] font-semibold text-[#0A1931]">{user.name}</div><div className="text-[10px] text-zinc-400">{user.role}</div></div>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

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
  { id: "favoris", label: "Favoris", Icon: Star, href: providerUrl(role, "favoris") },
];
