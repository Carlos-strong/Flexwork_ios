"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { FileText, ScrollText, LogOut, Shield, UserRound, BadgeCheck, ChevronDown } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { useUserIdentity } from "@/components/user-identity";
import { accountNavFor } from "@/components/dashboard/nav";
import { useSidebarBadges } from "@/components/dashboard/useSidebarBadges";
import { PROVIDER_ROLE_LABEL } from "@/lib/provider-display";
import type { NavItem } from "@/components/dashboard/nav";
import { logout } from "@/lib/logout";

// Menu du profil de la barre de navigation globale (2026-11-09).
//
// Il remplace le SIDEBAR des tableaux de bord : les rubriques de l'espace connecté (selon le
// rôle — src/components/dashboard/nav.ts), « Devis & Contrats », le compte et la déconnexion
// sont rangés par groupes dans un menu ouvert depuis l'avatar, disponible sur TOUTES les pages
// puisque la barre globale l'est. Les compteurs (messages non lus, nouvelles missions,
// candidatures…) sont ceux de l'ancien sidebar (useSidebarBadges).
//
// `AccountMenuSections` est le contenu seul : la barre le réutilise dans son menu mobile.

type SessionUser = { id?: string; email?: string | null; role?: string; isAdmin?: boolean };

const ITEM =
  "flex items-center gap-3 rounded-lg px-3 py-2 text-[14px] text-[#191224] hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none transition";

function isActive(pathname: string, href?: string): boolean {
  if (!href) return false;
  const path = href.split("?")[0];
  // Les tableaux de bord sont les préfixes de leurs rubriques : actifs seulement à l'exact.
  if (/^\/(client\/dashboard|dashboard\/[^/]+)$/.test(path)) return pathname === path;
  return pathname === path || pathname.startsWith(`${path}/`);
}

function Badge({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className="ml-auto min-w-5 h-5 px-1.5 rounded-full bg-[#6D28D9] text-white text-[11px] font-bold flex items-center justify-center">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function Group({ label, children }: { label?: string; children: React.ReactNode }) {
  return (
    <div className="py-2 border-t border-gray-100 first:border-t-0">
      {label && <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-widest text-zinc-400">{label}</p>}
      {children}
    </div>
  );
}

export function AccountMenuSections({ onNavigate, badges }: { onNavigate?: () => void; badges: Record<string, number> }) {
  const { data: session } = useSession();
  const pathname = usePathname() ?? "";
  const identity = useUserIdentity();
  const user = session?.user as SessionUser | undefined;
  const nav = accountNavFor(user?.role);
  const roleLabel = PROVIDER_ROLE_LABEL[user?.role ?? ""] ?? "Client";

  const link = (item: Pick<NavItem, "id" | "label" | "Icon" | "href">, count = 0) => {
    const active = isActive(pathname, item.href);
    return (
      <Link
        key={item.id}
        href={item.href ?? "#"}
        role="menuitem"
        aria-current={active ? "page" : undefined}
        onClick={onNavigate}
        className={`${ITEM} ${active ? "bg-violet-50 font-semibold" : ""}`}
      >
        <item.Icon aria-hidden className={`w-4 h-4 shrink-0 ${active ? "text-[#6D28D9]" : "text-zinc-400"}`} />
        <span className="truncate">{item.label}</span>
        <Badge n={count} />
      </Link>
    );
  };

  return (
    <>
      <div className="px-3 pt-1 pb-3">
        <p className="text-[15px] font-bold text-[#191224] truncate">{identity?.name ?? "Mon compte"}</p>
        <p className="text-[12.5px] text-zinc-500 truncate">
          {user?.email}
          {user?.isAdmin ? " · Admin" : ` · ${roleLabel}`}
        </p>
      </div>

      <Group>{nav.items.map((item) => link(item, badges[item.id] ?? 0))}</Group>

      {nav.documentsBase && (
        <Group label="Documents contractuels">
          {link({ id: "devis", label: "Mes devis", Icon: FileText, href: `${nav.documentsBase}?tab=devis&f=tous` })}
          {link({ id: "contrats", label: "Contrats signés", Icon: ScrollText, href: `${nav.documentsBase}?tab=contrats&f=tous` })}
        </Group>
      )}

      <Group label="Compte">
        {user?.id && link({ id: "profil-public", label: "Mon profil public", Icon: UserRound, href: `/profil/${user.id}` })}
        {link({ id: "kyc", label: "Vérification d'identité", Icon: BadgeCheck, href: "/kyc" })}
        {user?.isAdmin && link({ id: "admin", label: "Administration", Icon: Shield, href: "/admin" })}
      </Group>

      <Group>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            onNavigate?.();
            void logout("/");
          }}
          className={`${ITEM} w-full text-left`}
        >
          <LogOut aria-hidden className="w-4 h-4 text-zinc-400" />
          Déconnexion
        </button>
      </Group>
    </>
  );
}

/** Compteurs du menu, selon le rôle connecté (aucun pour un visiteur). */
export function useAccountBadges(): Record<string, number> {
  const { data: session, status } = useSession();
  const role = (session?.user as SessionUser | undefined)?.role;
  return useSidebarBadges(status === "authenticated" ? accountNavFor(role).mode : null);
}

// `badges` vient de la barre (useAccountBadges), qui les partage avec son menu mobile : un seul
// sondage des compteurs par page, et non un par composant.
export default function ProfileMenu({ badges }: { badges: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const identity = useUserIdentity();
  const { data: session } = useSession();
  // Initiales de repli tant que l'identité (/api/users/me) n'est pas chargée : la 1re lettre
  // de l'adresse, plutôt qu'une pastille vide.
  const fallbackInitial = ((session?.user as SessionUser | undefined)?.email ?? "?").charAt(0).toUpperCase();
  const total = Object.values(badges).reduce((s, n) => s + n, 0);
  const ref = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const pathname = usePathname();

  // Fermeture : clic extérieur, Échap (le focus revient au bouton), changement de page.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  useEffect(() => setOpen(false), [pathname]);

  return (
    <div className="relative" ref={ref}>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Menu du compte"
        className="relative flex items-center gap-1 rounded-full p-0.5 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6D28D9]/40 transition"
      >
        <Avatar src={identity?.avatarUrl} initials={identity?.initials ?? fallbackInitial} size={34} />
        <ChevronDown aria-hidden className={`w-4 h-4 text-zinc-500 transition-transform ${open ? "rotate-180" : ""}`} />
        {total > 0 && (
          <span className="absolute -top-0.5 left-6 w-2.5 h-2.5 rounded-full bg-[#6D28D9] ring-2 ring-white" aria-label={`${total} élément(s) en attente`} />
        )}
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label="Menu du compte"
          className="absolute right-0 top-full mt-2 w-[300px] max-h-[calc(100dvh-5rem)] overflow-y-auto bg-white rounded-2xl shadow-xl border border-gray-100 p-2 z-50"
        >
          <AccountMenuSections badges={badges} onNavigate={() => setOpen(false)} />
        </div>
      )}
    </div>
  );
}
