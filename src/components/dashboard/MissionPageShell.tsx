"use client";

// Chrome par défaut de l'app pour les pages mission (/missions/[id]/*) — sidebar + navbar
// DashboardLayout adaptés au RÔLE connecté (client → CLIENT_NAV, prestataire → providerNav).
// Rubrique active la plupart du temps « missions » (pas de rubrique dédiée pour contract,
// escrow, checkin, mediation, reviews). Centralise identité (UserIdentityProvider), badges
// (useSidebarBadges) et garde d'authentification (non connecté → /signin). Vérifié
// 2026-09-03 : items de nav avec href → la navigation se fait via les <Link> du sidebar,
// onNavChange reste un no-op (même convention que /client/missions).
//
// Utilisé par les sous-pages mission restées autonomes (proposals, contract, escrow,
// checkin, mediation, reviews) pour leur appliquer le même chrome que les dashboards.
//
// Exception : /missions/[id]/proposals est le détail atteint depuis « Propositions »
// (client) / « Mes candidatures » (prestataire) via leur bouton « Voir » — jusqu'ici la
// rubrique « missions » restait bandeau orange à sa place, donc le clic sur « Voir »
// déplaçait la surbrillance vers « Missions » au lieu de rester sur la rubrique d'origine
// (signalé 2026-09-04). On fait donc correspondre ce segment à la bonne rubrique, par rôle,
// au lieu du "missions" générique.
import { useEffect, type ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardLayout, { CLIENT_NAV, providerNav, type DashboardUser } from "@/components/dashboard/DashboardLayout";
import { useSidebarBadges } from "@/components/dashboard/useSidebarBadges";
import { useUserIdentity } from "@/components/user-identity";

type Role = "client" | "expert_digital" | "expert_btp_autres" | "artisan" | "manoeuvre";

const FALLBACK_CLIENT: DashboardUser = { initials: "CL", name: "Client", role: "Cliente", avatarGradient: "from-[#FF7A00] to-[#E8112D]" };
const FALLBACK_PROVIDER: DashboardUser = { initials: "PR", name: "Prestataire", role: "Prestataire", avatarGradient: "from-[#FF7A00] to-[#E8112D]" };

// Rubrique sidebar dédiée à /missions/[id]/proposals, par rôle — toute autre sous-page
// retombe sur "missions" (voir activeNav ci-dessous).
const PROPOSALS_ACTIVE_NAV = { client: "propositions", provider: "candidatures" } as const;

export default function MissionPageShell({ title = "Mission", children }: { title?: string; children: ReactNode }) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const pathname = usePathname() ?? "";
  const userSession = session?.user as { id?: string; role?: string } | undefined;
  const isClient = userSession?.role === "client";
  const role = userSession?.role as Role | undefined;
  const fallback = isClient ? FALLBACK_CLIENT : FALLBACK_PROVIDER;
  const badgeCounts = useSidebarBadges(isClient ? "client" : "prestataire");
  const identity = useUserIdentity();
  // /missions/{id}/proposals → reste sur "propositions"/"candidatures" ; toute autre
  // sous-page (contract, escrow, checkin, mediation, reviews) → "missions" (défaut).
  const segment = pathname.split("/").filter(Boolean).pop() ?? "";
  const activeNav = segment === "proposals" ? PROPOSALS_ACTIVE_NAV[isClient ? "client" : "provider"] : "missions";

  // Page protégée : un visiteur non connecté est redirigé vers la connexion.
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/signin");
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center">
        <div className="w-8 h-8 border-[3px] border-[#FF7A00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (status === "unauthenticated") return null;

  const user: DashboardUser = identity
    ? { ...fallback, name: identity.name, initials: identity.initials, avatarUrl: identity.avatarUrl ?? null, id: identity.id }
    : { ...fallback, avatarUrl: null, id: userSession?.id };

  return (
    <DashboardLayout
      mode={isClient ? "client" : "prestataire"}
      user={user}
      navItems={isClient ? CLIENT_NAV : providerNav(role ?? "expert_digital")}
      activeNav={activeNav}
      onNavChange={() => {}}
      badgeCounts={badgeCounts}
      title={title}
    >
      {children}
    </DashboardLayout>
  );
}
