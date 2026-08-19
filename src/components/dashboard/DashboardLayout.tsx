"use client";

import { useState, type ReactNode } from "react";
import { Search, LogOut, Menu, LayoutDashboard, Briefcase, MessageSquare, Heart, FileText, Wallet, Star } from "lucide-react";
import DashboardSidebar, { type NavItem, type SidebarUser } from "./DashboardSidebar";
import { NotificationsBell } from "@/components/notifications-bell";

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
              <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${user.avatarGradient} flex items-center justify-center text-white text-[10px] font-bold ring-2 ring-white shadow-sm`}>{user.initials}</div>
              <div className="hidden lg:block text-right leading-tight"><div className="text-[12px] font-semibold text-[#0A1931]">{user.name}</div><div className="text-[10px] text-zinc-400">{user.role}</div></div>
            </div>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

export const CLIENT_NAV: NavItem[] = [
  { id: "dashboard", label: "Tableau de bord", Icon: LayoutDashboard, href: "/client/dashboard" },
  { id: "missions", label: "Mes Missions", Icon: Briefcase, href: "/client/missions" },
  { id: "messages", label: "Messages", Icon: MessageSquare, badge: 3, href: "/client/messages" },
  { id: "propositions", label: "Propositions", Icon: FileText, badge: 5, href: "/client/propositions" },
  { id: "paiements", label: "Paiements", Icon: Wallet, href: "/client/paiements" },
  { id: "favoris", label: "Favoris", Icon: Heart, href: "/recherche" },
];

export const PROVIDER_NAV: NavItem[] = [
  { id: "dashboard", label: "Tableau de bord", Icon: LayoutDashboard },
  { id: "missions", label: "Missions disponibles", Icon: Briefcase, href: "/missions" },
  { id: "messages", label: "Messages", Icon: MessageSquare, badge: 2 },
  { id: "propositions", label: "Mes candidatures", Icon: FileText, badge: 4 },
  { id: "wallet", label: "Wallet", Icon: Wallet, href: "/dashboard/expert-digital" },
  { id: "favoris", label: "Favoris", Icon: Star, href: "/recherche" },
];
