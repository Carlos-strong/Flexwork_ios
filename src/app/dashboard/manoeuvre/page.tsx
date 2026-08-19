"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import DashboardLayout, { PROVIDER_NAV, type DashboardUser } from "@/components/dashboard/DashboardLayout";
import ChatView from "@/components/chat/ChatView";
import type { Session } from "next-auth";

const USER: DashboardUser = { initials: "MN", name: "Manœuvre", role: "Manœuvre", avatarGradient: "from-[#008751] to-[#FCD116]" };

export default function ManoeuvreDashboard() {
  const { data: session, status } = useSession() as { data: Session | null; status: string };
  const router = useRouter(); const [nav, setNav] = useState("dashboard");
  const currentUserId = (session?.user as { id?: string })?.id ?? "";
  const [badgeCounts, setBadgeCounts] = useState<Record<string, number>>({});
  useEffect(() => { if (status === "unauthenticated") router.push("/signin"); }, [status, router]);
  useEffect(() => { if (status === "authenticated") fetch("/api/messages").then(r => r.ok ? r.json() : { conversations: [] }).then(d => { const unread = (d.conversations ?? []).filter((c: { lastMessage?: { sent?: boolean } | null }) => c.lastMessage && !c.lastMessage.sent).length; setBadgeCounts(prev => ({ ...prev, messages: unread })); }).catch(() => {}); }, [status]);
  if (status === "loading") return <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center"><div className="w-8 h-8 border-[3px] border-[#FF7A00] border-t-transparent rounded-full animate-spin" /></div>;
  if (status === "unauthenticated") return null;

  return (
    <DashboardLayout mode="prestataire" user={USER} navItems={PROVIDER_NAV} activeNav={nav} onNavChange={setNav} badgeCounts={badgeCounts}
      title="Tableau de bord" solde="32 000"
    >
      {nav === "messages" ? (
        <ChatView currentUserId={currentUserId} onBack={() => setNav("dashboard")} />
      ) : (
      <>
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div><h1 className="text-[22px] md:text-[26px] font-bold text-[#0A1931] tracking-tight">Bonjour Manœuvre 👋</h1><p className="text-[13px] text-zinc-500 mt-1"><span className="text-[#FF7A00]">✦</span> <span className="font-semibold text-[#FF7A00]">2 missions</span> en cours • 3 nouvelles disponibles</p></div>
        <button className="h-9 px-4 rounded-full bg-white border border-gray-200 text-[13px] font-medium text-zinc-600">Filtres</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        {[{ label: "Missions actives", value: "2", sub: "+1 cette semaine", color: "from-[#22C55E] to-[#22C55E]" },{ label: "Gains", value: "98k", sub: "FCFA ce mois", color: "from-[#3B82F6] to-[#3B82F6]" },{ label: "Pointages", value: "24", sub: "ce mois", color: "from-[#8B5CF6] to-[#8B5CF6]" },{ label: "Fiabilité", value: "100%", sub: "ponctualité", color: "from-[#FF7A00] to-[#FF7A00]" }].map(s => (
          <div key={s.label} className="bg-white rounded-[16px] border border-gray-100 p-4 hover:shadow-md transition-shadow relative overflow-hidden"><div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${s.color}`} /><div className="text-[11px] uppercase tracking-widest text-zinc-400 font-semibold mb-1">{s.label}</div><div className="text-[28px] font-bold tracking-tight text-[#0A1931]">{s.value}</div><div className="text-[12px] text-zinc-400 mt-0.5">{s.sub}</div></div>
        ))}</div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden"><div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between"><h3 className="font-semibold text-[15px]">Missions disponibles</h3><button className="text-[12px] font-medium text-[#FF7A00]">Voir tout →</button></div>
            <div className="divide-y divide-gray-50">
              {[{ title: "Aide maçonnerie chantier", domaine: "Maçonnerie", budget: "25 000 FCFA", delai: "5 jours", client: "Entreprise BTP", pays: "BJ" },{ title: "Manutention stockage", domaine: "Manutention", budget: "18 000 FCFA", delai: "2 jours", client: "Entrepôt Cotonou", pays: "BJ" },{ title: "Nettoyage fin de chantier", domaine: "Nettoyage", budget: "12 000 FCFA", delai: "1 jour", client: "SCI Immo+", pays: "BJ" }].map((m,i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-4 hover:bg-gray-50/50 transition-colors cursor-pointer"><div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#008751] to-[#FCD116] flex items-center justify-center text-white text-[12px] font-bold shrink-0">{m.domaine.slice(0,2).toUpperCase()}</div><div className="flex-1 min-w-0"><div className="text-[13px] font-medium">{m.title}</div><div className="text-[11px] text-zinc-400"><span className="text-[#008751] font-medium">{m.pays}</span> • {m.client} • {m.domaine} • {m.delai}</div></div><div className="text-right shrink-0"><div className="text-[13px] font-semibold">{m.budget}</div><button className="mt-1 h-7 px-3 rounded-full bg-[#008751] text-white text-[10px] font-semibold">Candidater</button></div></div>
              ))}</div></div>
        </div>
        <div className="space-y-4">
          <div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden"><div className="px-5 py-4 border-b border-gray-50"><h3 className="font-semibold text-[14px]">📸 Pointage GPS</h3></div><div className="px-5 py-4 space-y-2 text-[12px]">
            <div className="p-3 rounded-xl bg-green-50"><span className="font-semibold text-green-800">Outil de preuve</span><p className="text-[11px] text-green-700 mt-1">Horodatage arrivée/départ + photo. Preuve entre vous et le client.</p></div>
            <div className="flex items-center gap-2 p-2 rounded-xl bg-red-50"><span className="w-2 h-2 rounded-full bg-red-500" /> Garant principal — <span className="font-semibold text-red-700">Requis</span></div>
            <div className="flex items-center gap-2 p-2 rounded-xl bg-gray-50"><span className="w-2 h-2 rounded-full bg-gray-400" /> Garants optionnels (2)</div>
          </div></div>
          <div className="bg-[#0A1931] rounded-[20px] p-5 text-white"><div className="text-[11px] text-white/60 font-semibold uppercase tracking-widest mb-1">Wallet</div><div className="text-[28px] font-bold tracking-tight">32 000 FCFA</div><div className="flex gap-2 mt-3"><button className="flex-1 h-9 rounded-full bg-white text-[#0A1931] text-[12px] font-semibold">Retirer</button><button className="flex-1 h-9 rounded-full bg-white/10 text-white text-[12px]">Historique</button></div></div>
        </div>
      </div>
      </>
      )}
    </DashboardLayout>
  );
}
