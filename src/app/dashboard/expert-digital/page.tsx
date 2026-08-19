"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import DashboardLayout, { PROVIDER_NAV, type DashboardUser } from "@/components/dashboard/DashboardLayout";
import ChatView from "@/components/chat/ChatView";
import type { Session } from "next-auth";

const USER: DashboardUser = { initials: "ED", name: "Expert Digital", role: "Expert Digital", avatarGradient: "from-[#008751] to-[#FCD116]" };

export default function ExpertDigitalDashboard() {
  const { data: session, status } = useSession() as { data: Session | null; status: string };
  const router = useRouter(); const [nav, setNav] = useState("dashboard");
  const currentUserId = (session?.user as { id?: string })?.id ?? "";
  const [badgeCounts, setBadgeCounts] = useState<Record<string, number>>({});
  useEffect(() => { if (status === "unauthenticated") router.push("/signin"); }, [status, router]);
  useEffect(() => { if (status === "authenticated") fetch("/api/messages").then(r => r.ok ? r.json() : { conversations: [] }).then(d => { const unread = (d.conversations ?? []).filter((c: { lastMessage?: { sent?: boolean } | null }) => c.lastMessage && !c.lastMessage.sent).length; setBadgeCounts(prev => ({ ...prev, messages: unread })); }).catch(() => {}); }, [status]);
  if (status === "loading") return <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center"><div className="w-8 h-8 border-[3px] border-[#FF7A00] border-t-transparent rounded-full animate-spin" /></div>;
  if (status === "unauthenticated") return null;

  return <ProviderDashboard user={USER} nav={nav} setNav={setNav} currentUserId={currentUserId} badgeCounts={badgeCounts} />;
}

// Shared Prestataire dashboard content
function ProviderDashboard({ user, nav, setNav, currentUserId, badgeCounts }: { user: DashboardUser; nav: string; setNav: (id: string) => void; currentUserId: string; badgeCounts: Record<string, number> }) {
  return (
    <DashboardLayout mode="prestataire" user={user} navItems={PROVIDER_NAV} activeNav={nav} onNavChange={setNav}
      title="Tableau de bord" solde="87 500" badgeCounts={badgeCounts}
    >
      {nav === "messages" ? (
        <ChatView currentUserId={currentUserId} onBack={() => setNav("dashboard")} />
      ) : (
      <>
      {/* Welcome */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[22px] md:text-[26px] font-bold text-[#0A1931] tracking-tight">Bonjour {user.name} 👋</h1>
          <p className="text-[13px] text-zinc-500 mt-1"><span className="text-[#FF7A00]">✦</span> Tu as <span className="font-semibold text-[#FF7A00]">4 nouvelles missions</span> aujourd&apos;hui • 2 en attente de validation</p>
        </div>
        <div className="flex items-center gap-2">
          <button className="h-9 px-4 rounded-full bg-white border border-gray-200 text-[13px] font-medium text-zinc-600 hover:bg-gray-50 transition-colors">Filtres</button>
          <button className="h-9 px-4 rounded-full bg-white border border-gray-200 text-[13px] font-medium text-zinc-600 hover:bg-gray-50 transition-colors">Calendrier</button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        {[
          { label: "Missions complétées", value: "12", sub: "+3 ce mois", color: "from-[#22C55E] to-[#22C55E]" },
          { label: "Revenus totaux", value: "487k", sub: "FCFA ce mois", color: "from-[#3B82F6] to-[#3B82F6]" },
          { label: "Candidatures", value: "8", sub: "en cours", color: "from-[#8B5CF6] to-[#8B5CF6]" },
          { label: "Taux de succès", value: "94%", sub: "satisfaction client", color: "from-[#FF7A00] to-[#FF7A00]" },
        ].map((s) => (
          <div key={s.label} className="bg-white rounded-[16px] border border-gray-100 p-4 md:p-5 hover:shadow-md transition-shadow relative overflow-hidden">
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${s.color}`} />
            <div className="text-[11px] uppercase tracking-widest text-zinc-400 font-semibold mb-1">{s.label}</div>
            <div className="text-[28px] md:text-[32px] font-bold tracking-tight text-[#0A1931]">{s.value}</div>
            <div className="text-[12px] text-zinc-400 mt-0.5">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Two columns */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* LEFT — Missions disponibles */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
              <h3 className="font-semibold text-[15px] text-[#0A1931]">Missions recommandées</h3>
              <button className="text-[12px] font-medium text-[#FF7A00] hover:underline">Voir tout →</button>
            </div>
            <div className="divide-y divide-gray-50">
              {[
                { title: "Refonte UI - Site E-commerce", domaine: "Design UI/UX", budget: "120 000 FCFA", delai: "7 jours", client: "Boutique Wax", pays: "BJ" },
                { title: "Développement API Paiement Mobile", domaine: "Dev Web", budget: "250 000 FCFA", delai: "14 jours", client: "Startup Fintech", pays: "SN" },
                { title: "Montage Vidéo TikTok - Campagne Wax", domaine: "Vidéo/Montage", budget: "45 000 FCFA", delai: "3 jours", client: "Studio SN", pays: "SN" },
              ].map((m, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-4 hover:bg-gray-50/50 transition-colors cursor-pointer">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF7A00] to-[#E8112D] flex items-center justify-center text-white text-[12px] font-bold shrink-0">{m.domaine.slice(0,2).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-[#0A1931]">{m.title}</div>
                    <div className="text-[11px] text-zinc-400"><span className="text-[#008751] font-medium">{m.pays}</span> • {m.client} • {m.domaine} • {m.delai}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[13px] font-semibold text-[#0A1931]">{m.budget}</div>
                    <button className="mt-1 h-7 px-3 rounded-full bg-[#008751] text-white text-[10px] font-semibold hover:brightness-110 transition-all">Candidater</button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Mes missions en cours */}
          <div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-[14px] text-[#0A1931]">Missions en cours</h3>
                <span className="px-1.5 py-0.5 rounded-full bg-[#22C55E] text-white text-[10px] font-bold">2</span>
              </div>
            </div>
            <div className="divide-y divide-gray-50">
              {[
                { title: "Logo + Charte graphique", client: "Aïcha D.", budget: "15 000 FCFA", echeance: "12 Août", progression: "80%" },
                { title: "Site vitrine WordPress", client: "Kwame O.", budget: "85 000 FCFA", echeance: "20 Août", progression: "45%" },
              ].map((m, i) => (
                <div key={i} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-[13px] font-medium text-[#0A1931]">{m.title}</div>
                      <div className="text-[11px] text-zinc-400">{m.client} • {m.budget} • Échéance {m.echeance}</div>
                    </div>
                    <span className="text-[12px] font-bold text-[#008751]">{m.progression}</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full bg-[#008751]" style={{ width: m.progression }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — Activité & Wallet */}
        <div className="space-y-4">
          <div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50">
              <h3 className="font-semibold text-[14px] text-[#0A1931]">Activité récente</h3>
            </div>
            <div className="px-5 py-4 space-y-3">
              {[
                { text: "Nouvelle mission : Refonte UI", time: "Il y a 2h", icon: "📋" },
                { text: "Candidature acceptée : Logo Wax", time: "Il y a 5h", icon: "✅" },
                { text: "Paiement reçu : 15 000 FCFA", time: "Hier", icon: "💰" },
                { text: "Message de Aïcha D.", time: "Hier", icon: "💬" },
              ].map((a, i) => (
                <div key={i} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">{a.icon}</div>
                  <div>
                    <p className="text-[12px] font-medium text-[#0A1931]">{a.text}</p>
                    <p className="text-[11px] text-zinc-400">{a.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Wallet preview */}
          <div className="bg-[#0A1931] rounded-[20px] p-5 text-white">
            <div className="text-[11px] text-white/60 font-semibold uppercase tracking-widest mb-1">Wallet</div>
            <div className="text-[28px] font-bold tracking-tight">87 500 FCFA</div>
            <div className="flex gap-2 mt-3">
              <button className="flex-1 h-9 rounded-full bg-white text-[#0A1931] text-[12px] font-semibold hover:bg-gray-100 transition-colors">Retirer</button>
              <button className="flex-1 h-9 rounded-full bg-white/10 text-white text-[12px] font-medium hover:bg-white/20 transition-colors">Historique</button>
            </div>
          </div>
        </div>
      </div>
      </>
      )}
    </DashboardLayout>
  );
}
