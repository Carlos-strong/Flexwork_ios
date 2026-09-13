"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { X, FileText, ScrollText } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar } from "@/components/avatar";

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
  /** Id du compte connecté — présent, rend la photo de profil cliquable vers /profil/[id]. */
  id?: string | null;
  initials: string;
  name: string;
  role: string;
  avatarGradient: string;
  /** Photo de profil réelle (/api/users/[id]/avatar) — absent ou en échec de chargement, on retombe sur initials+avatarGradient. */
  avatarUrl?: string | null;
};

/** Action de pied de barre (lien ou bouton). */
export type SidebarAction = {
  id: string;
  label: string;
  Icon: LucideIcon;
  href?: string;
  onClick?: () => void;
};

// ── Bloc « Documents Contractuels » (rubriques + sous-rubriques, Sidecar-Vjr) ──
export type DocumentsLink = { id: string; label: string; count?: number };
export type DocumentsBlock = {
  /** URL de base de la rubrique « Devis & Contrats » — les sous-rubriques ajoutent ?tab=&f=. */
  base: string;
  devis: DocumentsLink[];
  contrats: DocumentsLink[];
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
  /** Bloc « Documents Contractuels » (Mes Devis / Contrats Signés + sous-rubriques) —
      rendu en fin de navigation, fidèle au modèle Sidecar-Devis-Contrats-Signes-Vjr. */
  documents?: DocumentsBlock;
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
  documents,
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

          {/* Bloc « Documents Contractuels » — isolé dans son propre composant sous
              Suspense : useSearchParams() (état actif des sous-rubriques) exige une
              frontière Suspense en Next 14 App Router, et DashboardSidebar est monté par
              une dizaine de pages qu'on ne va pas toutes faire dépendre de ça. */}
          {documents && (
            <Suspense fallback={<DocumentsNavStatic documents={documents} onClose={onClose} />}>
              <DocumentsNav documents={documents} onClose={onClose} />
            </Suspense>
          )}
        </nav>

        {/* Pied : slot + utilisateur + actions */}
        <div className="shrink-0 px-3 py-4 border-t border-white/[0.08] space-y-3">
          {footer}
          {user && (
            <div className="flex items-center gap-3 px-2 py-1">
              {user.id ? (
                <Link href={`/profil/${user.id}`} onClick={onClose} title="Voir mon profil">
                  <Avatar src={user.avatarUrl} initials={user.initials} gradient={user.avatarGradient} size={32} className="hover:opacity-80 transition" />
                </Link>
              ) : (
                <Avatar src={user.avatarUrl} initials={user.initials} gradient={user.avatarGradient} size={32} />
              )}
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

type DocumentsActive = { tab: string; filter: string } | null;

// Rendu partagé entre la version pilotée par l'URL (DocumentsNav, sous Suspense) et le
// fallback statique (DocumentsNavStatic, affiché le temps que useSearchParams résolve —
// en pratique quasi instantané côté client) : même structure, seul l'état actif diffère.
function DocumentsNavContent({ documents, onClose, active }: { documents: DocumentsBlock; onClose: () => void; active: DocumentsActive }) {
  return (
    <div>
      <p className="px-3 mb-1 text-[10px] uppercase tracking-widest text-white/30 font-semibold">Documents Contractuels</p>
      <div className="space-y-3">
        {(
          [
            { key: "devis", label: "Mes Devis", Icon: FileText, links: documents.devis },
            { key: "contrats", label: "Contrats Signés", Icon: ScrollText, links: documents.contrats },
          ] as const
        ).map((group) => (
          <div key={group.key} className="space-y-1">
            <Link
              href={`${documents.base}?tab=${group.key}&f=tous`}
              onClick={onClose}
              style={{ textDecoration: "none" }}
              className={`w-full flex items-center gap-3 px-3 py-[11px] rounded-xl text-[14px] font-medium transition-all ${active?.tab === group.key && active.filter === "tous" ? "bg-[#FF7A00] text-white shadow-[0_4px_16px_rgba(255,122,0,0.35)]" : "text-white/70 hover:text-white hover:bg-white/[0.07]"}`}
            >
              <group.Icon className="w-[18px] h-[18px] shrink-0" />
              <span className="flex-1 truncate">{group.label}</span>
            </Link>
            <div className="ml-4 pl-3 border-l border-white/10 space-y-1">
              {group.links.map((link) => {
                const isActive = active?.tab === group.key && active.filter === link.id;
                return (
                  <Link
                    key={link.id}
                    href={`${documents.base}?tab=${group.key}&f=${link.id}`}
                    onClick={onClose}
                    style={{ textDecoration: "none" }}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[13px] transition-colors ${isActive ? "text-white font-medium bg-white/[0.07]" : "text-white/50 hover:text-white"}`}
                  >
                    <span>{link.label}</span>
                    {typeof link.count === "number" && link.count > 0 && (
                      <span className="text-[11px] bg-white/10 px-1.5 py-0.5 rounded-full">{link.count}</span>
                    )}
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Sous-rubrique active dérivée de l'URL réelle (?tab=devis|contrats&f=<id>) — de vrais
// liens <Link>, pas des boutons pilotés par activeId/onSelect comme les sections du haut.
function DocumentsNav({ documents, onClose }: { documents: DocumentsBlock; onClose: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const active: DocumentsActive = pathname === documents.base ? { tab: searchParams.get("tab") ?? "devis", filter: searchParams.get("f") ?? "tous" } : null;
  return <DocumentsNavContent documents={documents} onClose={onClose} active={active} />;
}

function DocumentsNavStatic({ documents, onClose }: { documents: DocumentsBlock; onClose: () => void }) {
  return <DocumentsNavContent documents={documents} onClose={onClose} active={null} />;
}
