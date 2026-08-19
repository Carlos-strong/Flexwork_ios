"use client";

import { useEffect } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import DashboardLayout, { CLIENT_NAV, type DashboardUser } from "@/components/dashboard/DashboardLayout";
import Messagerie from "@/components/dashboard/Messagerie";

const USER: DashboardUser = {
  initials: "CL",
  name: "Aïcha D.",
  role: "Cliente",
  avatarGradient: "from-[#FF7A00] to-[#E8112D]",
};

export default function ClientMessagesPage() {
  const { data: session, status } = useSession() as { data: { user?: { id?: string } } | null; status: string };
  const router = useRouter();
  const currentUserId = session?.user?.id ?? "";

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
      user={USER}
      navItems={CLIENT_NAV}
      activeNav="messages"
      onNavChange={() => {}}
      title="Tableau de bord / Messages"
    >
      <Messagerie currentUserId={currentUserId} />
    </DashboardLayout>
  );
}
