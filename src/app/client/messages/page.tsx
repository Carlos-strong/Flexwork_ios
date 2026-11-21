"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import DashboardLayout, { CLIENT_NAV, type DashboardUser } from "@/components/dashboard/DashboardLayout";
import Messagerie from "@/components/dashboard/Messagerie";
import { useUserIdentity } from "@/components/user-identity";

const FALLBACK_USER: DashboardUser = {
  initials: "CL",
  name: "Client",
  role: "Cliente",
  avatarGradient: "from-[#6D28D9] to-[#B42318]",
};

export default function ClientMessagesPage() {
  const { data: session, status } = useSession() as { data: { user?: { id?: string } } | null; status: string };
  const router = useRouter();
  const currentUserId = session?.user?.id ?? "";
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
      <div className="min-h-screen bg-[#F6F5FA] flex items-center justify-center">
        <div className="w-8 h-8 border-[3px] border-[#6D28D9] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (status === "unauthenticated") return null;

  return (
    <DashboardLayout
      user={user}
      navItems={CLIENT_NAV}
      activeNav="messages"
      title="Tableau de bord / Messages"
    >
      <Messagerie currentUserId={currentUserId} />
    </DashboardLayout>
  );
}
