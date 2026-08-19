"use client";

import Link from "next/link";
import { X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** Élément de navigation (bouton ou lien selon `href`). */
export type NavItem = {
  id: string;
  label: string;
  Icon: LucideIcon;
  /** Si présent, l'item est rendu comme <Link>. */
  href?: string;
  /** Badge numérique affiché à droite (0 = masqué). */
  badge?: number;
};

/** Groupe d'items avec titre optionnel. */
export type NavSection = {
  id: string;
  label?: string;
  items: NavItem[];
};

/** Compat : alias d'un item raccourci (ancien usage). */
export type ShortcutItem = {
  href: string;
  label: string;
  Icon: LucideIcon;
};

export type SidebarUser = {
  initials: string;
  name: string;
  role: string;
  avatarGradient: string;
};

/** Action de pied de barre (lien ou bouton). */
export type SidebarAction = {
  id: string;
  label: string;
  Icon: LucideIcon;
  href?: string;
  onClick?: () => void;
};

type DashboardSidebarProps = {
  open: boolean;
  onClose: () => void;
  sections: NavSection[];
  activeId: string;
  onSelect: (id: string) => void;
  user?: SidebarUser | null;
  badgeCounts?: Record<string, number>;
  /** Slot optionnel rendu juste sous le logo (ex: bascule Client/Prestataire). */
  header?: ReactNode;
  /** Slot optionnel rendu au-dessus du bloc utilisateur (ex: carte promo). */
  footer?: ReactNode;
  /** Actions du bas de barre (ex: déconnexion, aide). */
  footerActions?: SidebarAction[];
};

export default function DashboardSidebar({
  open,
  onClose,
  sections,
  activeId,
  onSelect,
  user,
  badgeCounts,
  header,
  footer,
  footerActions,
}: DashboardSidebarProps) {
  return (
    <>
      {open && (
        <div onClick={onClose} className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden" />
      )}

      <aside className={`fixed lg:sticky top-0 left-0 z-50 lg:z-30 h-full w-[260px] bg-[#0A1931] text-white flex flex-col transition-transform duration-300 ${open ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}>
        <div className="h-[4px] w-full shrink-0 bg-[linear-gradient(90deg,#FF7A00_0%,#FCD116_33%,#008751_66%,#8B5CF6_100%)]" />

        {/* Logo */}
        <div className="h-[68px] flex items-center justify-between px-5 shrink-0">
          <Link href="/" className="flex items-center gap-1.5" style={{ textDecoration: "none" }}>
            <span className="text-white font-extrabold text-[19px] tracking-tight">flex</span>
            <span className="text-[#FF7A00] font-extrabold text-[19px] tracking-tight">work</span>
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF7A00] inline-block -mt-2" />
          </Link>
          <button onClick={onClose} className="lg:hidden p-1.5 rounded-lg hover:bg-white/[0.08]"><X className="w-4 h-4" /></button>
        </div>

        {header && <div className="px-3 pb-2 shrink-0">{header}</div>}

        {/* Navigation par sections */}
        <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-3">
          {sections.map((section) => (
            <div key={section.id}>
              {section.label && (
                <p className="px-3 mb-1 text-[10px] uppercase tracking-widest text-white/30 font-semibold">{section.label}</p>
              )}
              <div className="space-y-1">
                {section.items.map(({ id, label, Icon, href, badge }) => {
                  const active = activeId === id;
                  const effectiveBadge = badgeCounts?.[id] ?? badge ?? 0;
                  const classes = `w-full flex items-center gap-3 px-3 py-[11px] rounded-xl text-[14px] font-medium transition-all text-left ${active ? "bg-[#FF7A00] text-white shadow-[0_4px_16px_rgba(255,122,0,0.35)]" : "text-white/70 hover:text-white hover:bg-white/[0.07]"}`;
                  const inner = (
                    <>
                      <Icon className="w-[18px] h-[18px] shrink-0" />
                      <span className="flex-1 truncate">{label}</span>
                      {effectiveBadge > 0 && (
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${active ? "bg-white text-[#FF7A00]" : "bg-[#FF7A00] text-white"}`}>{effectiveBadge}</span>
                      )}
                    </>
                  );
                  if (href) return <Link key={id} href={href} onClick={onClose} className={classes} style={{ textDecoration: "none" }}>{inner}</Link>;
                  return <button key={id} onClick={() => { onSelect(id); onClose(); }} className={classes}>{inner}</button>;
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Pied : slot + utilisateur + actions */}
        <div className="shrink-0 px-3 py-4 border-t border-white/[0.08] space-y-3">
          {footer}
          {user && (
            <div className="flex items-center gap-3 px-2 py-1">
              <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${user.avatarGradient} flex items-center justify-center text-white text-[10px] font-bold`}>{user.initials}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[12px] font-semibold truncate">{user.name}</div>
                <div className="text-[10px] text-white/50 truncate">{user.role}</div>
              </div>
            </div>
          )}
          {footerActions?.map(({ id, label, Icon, href, onClick }) => {
            const classes = "w-full flex items-center gap-2 px-3 h-9 rounded-xl text-[13px] text-white/70 hover:text-white hover:bg-white/[0.07] transition-all text-left";
            const inner = <><Icon className="w-4 h-4 shrink-0" /> {label}</>;
            if (href) return <Link key={id} href={href} onClick={onClose} className={classes} style={{ textDecoration: "none" }}>{inner}</Link>;
            return <button key={id} onClick={onClick} className={classes}>{inner}</button>;
          })}
        </div>
      </aside>
    </>
  );
}
