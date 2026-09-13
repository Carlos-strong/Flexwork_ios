"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import DashboardLayout, { CLIENT_NAV, type DashboardUser } from "@/components/dashboard/DashboardLayout";
import MesMissions from "@/components/dashboard/MesMissions";
import { useSidebarBadges } from "@/components/dashboard/useSidebarBadges";
import { useUserIdentity } from "@/components/user-identity";

const FALLBACK_USER: DashboardUser = {
  initials: "CL",
  name: "Client",
  role: "Cliente",
  avatarGradient: "from-[#FF7A00] to-[#E8112D]",
};

export default function ClientMissionsPage() {
  const { data: session, status } = useSession() as { data: { user?: { id?: string } } | null; status: string };
  const router = useRouter();
  const currentUserId = session?.user?.id ?? "";
  // Badges du sidebar pilotés par les événements réels (messages, propositions, paiements,
  // missions à action) — même hook que les dashboards prestataires.
  const badgeCounts = useSidebarBadges("client");
  // Identité réelle (prénom/initiales) — la session JWT ne porte jamais firstname/lastname
  // (voir src/auth.ts) : "Aïcha D." s'affichait pour tout le monde, sans lien avec le
  // compte réellement connecté.
  // Identité réelle partagée — chargée UNE fois au niveau racine (UserIdentityProvider), PAS
  // à chaque clic de rubrique. Photo via /api/users/me (avatarUrl null si absente → initiales).
  const identity = useUserIdentity();
  const user: DashboardUser = identity ? { ...FALLBACK_USER, name: identity.name, initials: identity.initials, avatarUrl: identity.avatarUrl ?? null, id: identity.id } : { ...FALLBACK_USER, avatarUrl: null, id: currentUserId };

  useEffect(() => {
    if (status === "unauthenticated") router.push("/signin");
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center">
        <div className="w-8 h-8 border-[3px] border-[#FF7A00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (status === "unauthenticated") return null;

  return (
    <DashboardLayout
      mode="client"
      user={user}
      navItems={CLIENT_NAV}
      activeNav="missions"
      onNavChange={() => {}}
      badgeCounts={badgeCounts}
      title="Tableau de bord / Mes Missions"
    >
      <MesMissions />
    </DashboardLayout>
  );
}
