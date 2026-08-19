"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Search, X, MessageCircle, ArrowLeft } from "lucide-react";
import DashboardLayout, { CLIENT_NAV, type DashboardUser } from "@/components/dashboard/DashboardLayout";
import { MISSION_STATUS_STYLE } from "@/lib/mission-status";
import ChatView from "@/components/chat/ChatView";
import type { Session } from "next-auth";

type Mission = { id: string; titre: string; status: string; budget: number; currency: string; domaine?: string; _count?: { proposals: number } };

const USER: DashboardUser = {
  initials: "CL", name: "Aïcha D.", role: "Cliente",
  avatarGradient: "from-[#FF7A00] to-[#E8112D]",
};

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  brouillon: { label: "Brouillon", color: "text-gray-500", bg: "bg-gray-100", dot: "bg-gray-400" },
  publiee: { label: "Ouverte", color: "text-[#008751]", bg: "bg-[#f0faf5]", dot: "bg-[#008751]" },
  proposition_acceptee: { label: "En cours", color: "text-blue-700", bg: "bg-blue-50", dot: "bg-blue-500" },
  contrat_genere: { label: "En cours", color: "text-blue-700", bg: "bg-blue-50", dot: "bg-blue-500" },
  contrat_signe: { label: "En cours", color: "text-blue-700", bg: "bg-blue-50", dot: "bg-blue-500" },
  en_cours: { label: "En cours", color: "text-blue-700", bg: "bg-blue-50", dot: "bg-blue-500" },
  livrable_soumis: { label: "En révision", color: "text-amber-700", bg: "bg-amber-50", dot: "bg-amber-500" },
  validee: { label: "Livrée", color: "text-green-700", bg: "bg-green-50", dot: "bg-green-500" },
  cloturee: { label: "Livrée", color: "text-green-700", bg: "bg-green-50", dot: "bg-green-500" },
  mediation_ouverte: { label: "Litige", color: "text-red-700", bg: "bg-red-50", dot: "bg-red-500" },
};

const NAV_URLS: Record<string, string> = {
  dashboard: "/client/dashboard",
  missions: "/client/missions",
  messages: "/client/messages",
  propositions: "/client/propositions",
  paiements: "/client/paiements",
};

export default function ClientDashboardPage({ initialNav = "dashboard" }: { initialNav?: string } = {}) {
  const { data: session, status } = useSession() as { data: Session | null; status: string };
  const router = useRouter();
  const currentUserId = (session?.user as { id?: string })?.id ?? "";
  const nav = initialNav;
  const goTo = (id: string) => router.push(NAV_URLS[id] ?? NAV_URLS.dashboard);
  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("Toutes");
  const [badgeCounts, setBadgeCounts] = useState<Record<string, number>>({});

  useEffect(() => { if (status === "unauthenticated") router.push("/signin"); }, [status, router]);

  // Fetch missions
  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/missions").then(r => r.ok ? r.json() : { items: [] }).then(d => setMissions(d.items ?? []));
  }, [status]);

  // Fetch badge counts (messages + proposals)
  useEffect(() => {
    if (status !== "authenticated") return;
    // Messages unread
    fetch("/api/messages").then(r => r.ok ? r.json() : { conversations: [] }).then(d => {
      const unread = (d.conversations ?? []).filter((c: { lastMessage?: { sent?: boolean } | null }) =>
        c.lastMessage && !c.lastMessage.sent
      ).length;
      setBadgeCounts(prev => ({ ...prev, messages: unread }));
    }).catch(() => {});
  }, [status]);

  // Synchronise le badge "propositions" à partir des missions chargées.
  // NB : ce hook doit rester AVANT les retours anticipés, sinon React émet
  // « Rendered more hooks than expected » lors du passage loading → authenticated.
  useEffect(() => {
    if (missions) {
      const total = missions.reduce((s, m) => s + (m._count?.proposals ?? 0), 0);
      setBadgeCounts(prev => ({ ...prev, propositions: total }));
    }
  }, [missions]);

  if (status === "loading") return <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center"><div className="w-8 h-8 border-[3px] border-[#FF7A00] border-t-transparent rounded-full animate-spin" /></div>;
  if (status === "unauthenticated") return null;

  const all = missions ?? [];
  const actives = all.filter(m => !["brouillon", "publiee", "cloturee"].includes(m.status));
  const enCours = actives.length;
  const livraison = all.filter(m => m.status === "livrable_soumis").length;
  const totalProposals = all.reduce((s, m) => s + (m._count?.proposals ?? 0), 0);
  const missionsWithProposals = all.filter(m => (m._count?.proposals ?? 0) > 0).slice(0, 2);
  const filterStatusMap: Record<string, string[]> = { Toutes: [], publiee: ["publiee"], en_cours: ["proposition_acceptee","contrat_genere","contrat_signe","en_cours"], revision: ["livrable_soumis"], cloturee: ["validee","cloturee"] };
  const filteredMissions = all.filter(m => { const ms = m.titre.toLowerCase().includes(search.toLowerCase()) || (m.domaine??"").toLowerCase().includes(search.toLowerCase()); const mf = activeFilter==="Toutes" || (filterStatusMap[activeFilter]??[]).includes(m.status); return ms && mf; });

  return (
    <DashboardLayout mode="client" user={USER} navItems={CLIENT_NAV} activeNav={nav} onNavChange={goTo} badgeCounts={badgeCounts}
      title={nav==="missions"?"Tableau de bord / Mes Missions":nav==="propositions"?"Tableau de bord / Propositions":nav==="messages"?"Tableau de bord / Messages":nav==="paiements"?"Tableau de bord / Paiements":"Tableau de bord"}
    >
      {nav==="missions" && <>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3"><button onClick={()=>goTo("dashboard")} className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-100"><ArrowLeft className="w-4 h-4 text-zinc-600"/></button><div><h1 className="text-[22px] font-bold text-[#0A1931]">Mes Missions</h1><p className="text-[12px] text-zinc-500 mt-0.5">Gère toutes tes missions en un seul endroit.</p></div></div>
          <Link href="/missions/new" className="md:hidden flex h-9 px-4 rounded-full bg-[#FF7A00] text-white text-[12px] font-semibold items-center gap-1.5" style={{textDecoration:"none"}}><Plus className="w-3.5 h-3.5"/>Nouvelle mission</Link>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-5">
          {[{l:"Total",v:all.length,s:"toutes missions",c:"from-[#0A1931] to-[#0A1931]",f:"Toutes"},{l:"En cours",v:all.filter(m=>["proposition_acceptee","contrat_genere","contrat_signe","en_cours"].includes(m.status)).length,s:"actif maintenant",c:"from-[#3B82F6] to-[#3B82F6]",f:"en_cours"},{l:"En révision",v:all.filter(m=>m.status==="livrable_soumis").length,s:"en attente validation",c:"from-[#FCD116] to-[#FCD116]",f:"revision"},{l:"Livrées",v:all.filter(m=>["validee","cloturee"].includes(m.status)).length,s:"terminees",c:"from-[#22C55E] to-[#22C55E]",f:"cloturee"}].map(s=><div key={s.l} onClick={()=>setActiveFilter(s.f)} className="bg-white rounded-[16px] border border-gray-100 p-4 hover:shadow-md transition-shadow relative overflow-hidden cursor-pointer"><div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${s.c}`}/><div className="text-[11px] uppercase tracking-widest text-zinc-400 font-semibold mb-1">{s.l}</div><div className="text-[24px] font-bold text-[#0A1931]">{s.v}</div><div className="text-[12px] text-zinc-400 mt-0.5">{s.s}</div></div>)}
        </div>
        <div className="relative mb-4"><Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400"/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher mission..." className="w-full h-11 pl-11 pr-11 rounded-xl bg-white border border-gray-100 text-[14px] placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-[#FF7A00]/20 focus:border-[#FF7A00] transition-all shadow-sm"/>{search&&<button onClick={()=>setSearch("")} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200"><X className="w-4 h-4"/></button>}</div>
        <div className="flex items-center gap-2 mb-5 overflow-x-auto pb-2">
          {[{id:"Toutes",l:"Toutes",c:all.length},{id:"publiee",l:"Ouvertes",c:all.filter(m=>m.status==="publiee").length},{id:"en_cours",l:"En cours",c:all.filter(m=>["proposition_acceptee","contrat_genere","contrat_signe","en_cours"].includes(m.status)).length},{id:"revision",l:"En révision",c:all.filter(m=>m.status==="livrable_soumis").length},{id:"cloturee",l:"Livrées",c:all.filter(m=>["validee","cloturee"].includes(m.status)).length}].map(t=>{const a=activeFilter===t.id;return <button key={t.id} onClick={()=>setActiveFilter(t.id)} className={`h-9 px-4 rounded-full text-[13px] font-medium whitespace-nowrap transition-all border ${a?"bg-[#0A1931] text-white border-[#0A1931]":"bg-white text-zinc-600 border-gray-100 hover:border-gray-200"}`}>{t.l} <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${a?"bg-white/20 text-white":"bg-gray-100 text-zinc-500"}`}>{t.c}</span></button>})}
        </div>
        <div className="space-y-3">
          {filteredMissions.length===0?<div className="bg-white rounded-[20px] border border-gray-100 p-12 text-center"><div className="text-4xl mb-3">{search?"🔍":"📋"}</div><p className="text-[14px] text-zinc-500 font-medium">{search?"Aucune mission trouvée":"Aucune mission"}</p>{!search&&<Link href="/missions/new" className="mt-4 inline-flex h-9 px-5 rounded-full bg-[#FF7A00] text-white text-[12px] font-semibold items-center" style={{textDecoration:"none"}}>+ Nouvelle mission</Link>}</div>
          :filteredMissions.map(m=>{const c=STATUS_CONFIG[m.status]??STATUS_CONFIG.brouillon;return <div key={m.id} className="bg-white rounded-[20px] border border-gray-100 p-5 hover:shadow-md transition-shadow"><div className="flex flex-col md:flex-row md:items-center gap-4"><div className="flex-1 min-w-0"><div className="flex items-center gap-2 mb-2"><span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold ${c.bg} ${c.color}`}><span className={`w-1.5 h-1.5 rounded-full ${c.dot}`}/>{c.label}</span><span className="text-[10px] text-zinc-400 font-mono">#{m.id.slice(-6).toUpperCase()}</span><span className="text-[11px] text-zinc-400 ml-auto">⏰ {m.status==="cloturee"?"Terminé":m.status==="publiee"?"En attente":"Actif"}</span></div><h3 className="text-[15px] font-semibold text-[#0A1931] leading-snug">{m.titre}</h3><div className="flex items-center gap-3 mt-2 flex-wrap">{m.domaine&&<span className="text-[12px] text-zinc-500">{m.domaine}</span>}<span className="text-[14px] font-bold text-[#0A1931]">{m.budget.toLocaleString("fr-FR")} {m.currency}</span>{(m._count?.proposals??0)>0&&<span className="px-2 py-0.5 rounded-full bg-[#8B5CF6]/10 text-[#8B5CF6] text-[11px] font-semibold">{m._count?.proposals} proposition{m._count?.proposals!==1?"s":""}</span>}</div></div><div className="flex items-center gap-2 shrink-0"><Link href={`/missions/${m.id}/contract`} className="h-9 px-5 rounded-full bg-[#008751] text-white text-[12px] font-semibold flex items-center hover:brightness-110" style={{textDecoration:"none"}}>Voir</Link><Link href={`/missions/${m.id}/messages`} className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200" style={{textDecoration:"none"}}><MessageCircle className="w-4 h-4 text-zinc-500"/></Link></div></div></div>})}
        </div>
      </>}
      {nav==="propositions" && <>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <button onClick={()=>goTo("dashboard")} className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-100"><ArrowLeft className="w-4 h-4 text-zinc-600"/></button>
            <div>
              <h1 className="text-[22px] font-bold text-[#0A1931]">Propositions</h1>
              <p className="text-[12px] text-zinc-500 mt-0.5">{totalProposals} proposition{totalProposals>1?"s":""} reçue{totalProposals>1?"s":""} sur {all.filter(m=>(m._count?.proposals??0)>0).length} mission{all.filter(m=>(m._count?.proposals??0)>0).length>1?"s":""}</p>
            </div>
          </div>
        </div>

        {/* KPIs */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-5">
          {[{l:"Total propositions",v:totalProposals,s:"toutes missions confondues",c:"from-[#8B5CF6] to-[#8B5CF6]"},{l:"Missions concernées",v:all.filter(m=>(m._count?.proposals??0)>0).length,s:"avec offres",c:"from-[#3B82F6] to-[#3B82F6]"},{l:"Missions ouvertes",v:all.filter(m=>m.status==="publiee").length,s:"en attente de propositions",c:"from-[#22C55E] to-[#22C55E]"},{l:"Moyenne par mission",v:all.filter(m=>(m._count?.proposals??0)>0).length>0?Math.round(totalProposals/all.filter(m=>(m._count?.proposals??0)>0).length):0,s:"offres/mission",c:"from-[#FCD116] to-[#FCD116]"}].map(s=><div key={s.l} className="bg-white rounded-[16px] border border-gray-100 p-4 hover:shadow-md transition-shadow relative overflow-hidden"><div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${s.c}`}/><div className="text-[11px] uppercase tracking-widest text-zinc-400 font-semibold mb-1">{s.l}</div><div className="text-[28px] font-bold text-[#0A1931]">{s.v}</div><div className="text-[12px] text-zinc-400 mt-0.5">{s.s}</div></div>)}
        </div>

        {/* List of missions with proposals */}
        <div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-50">
            <h3 className="font-semibold text-[15px] text-[#0A1931]">Missions avec propositions</h3>
          </div>
          {all.filter(m=>(m._count?.proposals??0)>0).length===0 ? (
            <div className="px-5 py-16 text-center">
              <div className="text-4xl mb-3">📨</div>
              <p className="text-[14px] text-zinc-500 font-medium">Aucune proposition reçue</p>
              <p className="text-[12px] text-zinc-400 mt-1">Publiez une mission pour recevoir des offres de prestataires.</p>
              <Link href="/missions/new" className="mt-4 inline-flex h-9 px-5 rounded-full bg-[#FF7A00] text-white text-[12px] font-semibold items-center hover:brightness-110" style={{textDecoration:"none"}}>+ Nouvelle mission</Link>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {all.filter(m=>(m._count?.proposals??0)>0).map(m=>{const c=STATUS_CONFIG[m.status]??STATUS_CONFIG.brouillon;return <Link key={m.id} href={`/missions/${m.id}`} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50/50 transition-colors" style={{textDecoration:"none",color:"inherit"}}><div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center text-white text-[12px] font-bold shrink-0">{m.titre.slice(0,2).toUpperCase()}</div><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><span className="text-[14px] font-semibold text-[#0A1931]">{m.titre}</span><span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.bg} ${c.color}`}>{c.label}</span></div><div className="text-[12px] text-zinc-400 mt-0.5">{m.budget.toLocaleString("fr-FR")} {m.currency}{m.domaine?` • ${m.domaine}`:""}</div></div><div className="text-right shrink-0"><div className="text-[20px] font-bold text-[#8B5CF6]">{m._count?.proposals}</div><div className="text-[10px] text-zinc-400">offre{m._count?.proposals!==1?"s":""}</div></div><div className="w-8 h-8 rounded-full bg-[#8B5CF6]/10 flex items-center justify-center shrink-0"><ArrowLeft className="w-4 h-4 text-[#8B5CF6] rotate-180"/></div></Link>})}
            </div>
          )}
        </div>
      </>}
      {nav==="messages" && <ChatView currentUserId={currentUserId} onBack={()=>goTo("dashboard")} />}
      {nav==="paiements" && <>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={()=>goTo("dashboard")} className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-100"><ArrowLeft className="w-4 h-4 text-zinc-600"/></button>
          <div>
            <h1 className="text-[22px] font-bold text-[#0A1931]">Paiements</h1>
            <p className="text-[12px] text-zinc-500 mt-0.5">Suis tes paiements et séquestres.</p>
          </div>
        </div>
        <div className="bg-white rounded-[20px] border border-gray-100 p-12 text-center">
          <div className="text-4xl mb-3">💳</div>
          <p className="text-[14px] text-zinc-500 font-medium">Aucun paiement à afficher</p>
          <p className="text-[12px] text-zinc-400 mt-1">Les paiements liés à tes missions apparaîtront ici.</p>
        </div>
      </>}
      {nav==="dashboard" && <>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
          <div><h1 className="text-[22px] md:text-[26px] font-bold text-[#0A1931]">Bonjour Aïcha 👋</h1><p className="text-[13px] text-zinc-500 mt-1"><span className="text-[#FF7A00]">✦</span> Tu as <span className="font-semibold text-[#FF7A00]">{livraison} livraison{livraison>1?"s":""} à valider</span> • {enCours} mission{enCours>1?"s":""} active{enCours>1?"s":""}</p></div>
          <div className="flex items-center gap-2"><Link href="/missions/new" className="h-9 px-4 rounded-full bg-[#008751] text-white text-[13px] font-semibold flex items-center hover:brightness-110" style={{textDecoration:"none"}}>+ Mission</Link><Link href="/recherche" className="h-9 px-4 rounded-full bg-white border border-gray-200 text-[13px] font-medium text-zinc-600 hover:bg-gray-50" style={{textDecoration:"none"}}>Trouver un talent</Link></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
          {[{l:"Missions actives",v:String(enCours),s:`${all.length} au total`,c:"from-[#3B82F6] to-[#3B82F6]"},{l:"Budget dépensé",v:all.reduce((s,m)=>s+m.budget,0).toLocaleString("fr-FR"),s:"FCFA total",c:"from-[#22C55E] to-[#22C55E]"},{l:"Propositions",v:String(totalProposals),s:"reçues — voir tout →",c:"from-[#8B5CF6] to-[#8B5CF6]",action:()=>goTo("propositions")},{l:"Clôturées",v:String(all.filter(m=>m.status==="cloturee").length),s:"missions terminées",c:"from-[#EF4444] to-[#EF4444]"}].map(s=><div key={s.l} onClick={s.action} className={`bg-white rounded-[16px] border border-gray-100 p-4 hover:shadow-md transition-shadow relative overflow-hidden ${s.action?"cursor-pointer":""}`}><div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${s.c}`}/><div className="text-[11px] uppercase tracking-widest text-zinc-400 font-semibold mb-1">{s.l}</div><div className="text-[28px] font-bold text-[#0A1931]">{s.v}</div><div className="text-[12px] text-zinc-400 mt-0.5">{s.s}</div></div>)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          <div className="lg:col-span-2"><div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden"><div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between"><h3 className="font-semibold text-[15px] text-[#0A1931]">Mes Missions récentes</h3>{all.length>0&&<button onClick={()=>goTo("missions")} className="text-[12px] font-medium text-[#FF7A00] hover:underline">Voir tout →</button>}</div><div className="divide-y divide-gray-50">{all.length===0?<div className="px-5 py-12 text-center"><div className="text-3xl mb-2">📋</div><p className="text-[13px] text-zinc-500 font-medium">Aucune mission</p><Link href="/missions/new" className="mt-4 inline-flex h-9 px-5 rounded-full bg-[#FF7A00] text-white text-[12px] font-semibold items-center" style={{textDecoration:"none"}}>+ Nouvelle mission</Link></div>:all.slice(0,5).map(m=>{const st=MISSION_STATUS_STYLE[m.status as keyof typeof MISSION_STATUS_STYLE]??MISSION_STATUS_STYLE.brouillon;return <Link key={m.id} href={`/missions/${m.id}/contract`} className="flex items-center gap-3 px-5 py-4 hover:bg-gray-50/50 transition-colors" style={{textDecoration:"none",color:"inherit"}}><div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0A1931] to-[#FF7A00] flex items-center justify-center text-white text-[12px] font-bold shrink-0">{m.titre.slice(0,2).toUpperCase()}</div><div className="flex-1 min-w-0"><div className="text-[13px] font-medium text-[#0A1931]">{m.titre}</div><div className="text-[11px] text-zinc-400">{m.budget.toLocaleString("fr-FR")} {m.currency}</div></div><span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-gray-100 text-zinc-600"><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`}/>{st.label}</span></Link>})}</div><div className="px-5 py-3 bg-gray-50/50 border-t border-gray-50 flex items-center gap-4 text-[11px] text-zinc-500"><span>Paiement sécurisé via</span><div className="flex items-center gap-3"><span className="flex items-center gap-1"><span className="w-5 h-5 rounded-full bg-yellow-400 flex items-center justify-center text-[10px] font-bold text-white">M</span>MTN MoMo</span><span className="flex items-center gap-1"><span className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-[10px] font-bold text-white">W</span>Wave</span><span className="flex items-center gap-1"><span className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center text-[10px] font-bold text-white">O</span>Orange</span></div></div></div></div>
          <div><div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden"><div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between"><div className="flex items-center gap-2"><h3 className="font-semibold text-[14px] text-[#0A1931]">Propositions reçues</h3>{totalProposals>0&&<span className="px-1.5 py-0.5 rounded-full bg-[#8B5CF6] text-white text-[10px] font-bold">{totalProposals}</span>}</div></div><div className="divide-y divide-gray-50">{missionsWithProposals.length===0?<div className="px-5 py-8 text-center"><div className="text-2xl mb-2">📨</div><p className="text-[12px] text-zinc-500">Aucune proposition reçue</p></div>:missionsWithProposals.map(m=><Link key={m.id} href={`/missions/${m.id}`} className="px-5 py-4 block hover:bg-gray-50/50" style={{textDecoration:"none",color:"inherit"}}><div className="flex items-center gap-3 mb-2"><div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#8B5CF6] to-[#3B82F6] flex items-center justify-center text-white text-[12px] font-bold shrink-0">{m.titre.slice(0,2).toUpperCase()}</div><div className="flex-1 min-w-0"><span className="text-[13px] font-semibold text-[#0A1931]">{m.titre}</span><div className="text-[11px] text-zinc-400">{m.budget.toLocaleString("fr-FR")} {m.currency}</div></div><span className="px-2 py-0.5 rounded-full bg-[#8B5CF6]/10 text-[#8B5CF6] text-[10px] font-bold">{m._count?.proposals} offre{m._count?.proposals!==1?"s":""}</span></div><div className="flex gap-2"><button className="flex-1 h-8 rounded-full bg-[#008751] text-white text-[11px] font-semibold">Voir les offres</button><button className="flex-1 h-8 rounded-full bg-gray-100 text-zinc-600 text-[11px] font-semibold">Détails</button></div></Link>)}</div>{totalProposals>2&&<div className="px-5 py-3 border-t border-gray-50"><Link href="/missions" className="w-full h-9 rounded-full bg-gray-50 text-[#FF7A00] text-[12px] font-semibold flex items-center justify-center hover:bg-gray-100" style={{textDecoration:"none"}}>Voir les {totalProposals} propositions</Link></div>}</div><div className="mt-4 bg-white rounded-[20px] border border-gray-100 p-4"><div className="flex items-center gap-2 mb-1"><span className="text-green-500 text-lg">🛡️</span><span className="font-semibold text-[13px] text-[#0A1931]">Paiement sécurisé</span></div><p className="text-[12px] text-zinc-500 leading-relaxed">Tes fonds sont bloqués jusqu'à validation. Remboursement garanti.</p></div></div>
        </div>
      </>}
    </DashboardLayout>
  );
}
