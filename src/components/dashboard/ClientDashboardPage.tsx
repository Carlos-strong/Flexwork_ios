"use client";

// Implémentation partagée du dashboard client, pilotée par `initialNav` (même pattern que
// providerNav côté prestataire — voir src/lib/provider-urls.ts). Vit ici plutôt que dans
// src/app/dashboard/client/page.tsx pour ne pas être auto-routée par Next.js : avant ce
// déplacement, `/dashboard/client` et `/client/dashboard` rendaient le même contenu sous
// deux URLs différentes (doublon), et le typage `PageProps` généré par Next.js pour la
// route `/dashboard/client` échouait sur la prop `initialNav` qui n'a rien d'une prop de
// page (params/searchParams). `/dashboard/client` redirige maintenant vers `/client/dashboard`
// (voir src/app/dashboard/client/page.tsx) ; ce composant est importé par les pages
// wrapper /client/dashboard, /client/propositions et /client/paiements.
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import DashboardLayout, { CLIENT_NAV, type DashboardUser } from "@/components/dashboard/DashboardLayout";
import ClientOffresPanel from "@/components/dashboard/gig/ClientOffresPanel";
import ClientPropositionsSection from "@/components/dashboard/client/PropositionsSection";
import DevisContratsSection from "@/components/dashboard/DevisContratsSection";
import { MISSION_STATUS_STYLE } from "@/lib/mission-status";
import { useSidebarBadges } from "@/components/dashboard/useSidebarBadges";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { useUserIdentity } from "@/components/user-identity";
import type { Session } from "next-auth";

type Mission = { id: string; titre: string; status: string; budget: number; currency: string; domaine?: string | null; _count?: { proposals: number }; contract?: { jalons: { status: string }[] } | null };

// Sur un contrat à jalons, mission.status ne passe jamais à "livrable_soumis" — seul
// jalon.status le fait, jalon par jalon (voir src/lib/psp-webhook.ts). Sans ce repli, une
// mission à jalons ayant un livrable réellement en attente de vérification n'apparaissait
// jamais dans "En révision" (tuile, filtre, ou badge sidebar).
function hasPendingJalon(m: Mission): boolean {
  return (m.contract?.jalons.length ?? 0) > 0 && m.contract!.jalons.some((j) => j.status === "livrable_soumis");
}
function isEnRevision(m: Mission): boolean {
  return m.status === "livrable_soumis" || hasPendingJalon(m);
}

// Données réelles du dashboard client (identité + agrégats + missions) renvoyées par
// /api/dashboard/client-summary — même modèle que provider-summary côté prestataire.
type ClientSummary = {
  user: { name: string; initials: string; firstName: string; avatarUrl: string | null };
  stats: { total: number; active: number; pendingValidations: number; totalProposals: number; budgetSpent: number; closed: number; open: number };
  missions: Mission[];
  activity: Array<{ id: string; message: string; icon: string; createdAt: string }>;
};

// Repli pendant le chargement — remplacé par l'identité réelle dès que le summary arrive.
const USER: DashboardUser = {
  initials: "CL", name: "Cliente", role: "Cliente",
  avatarGradient: "from-[#FF7A00] to-[#E8112D]",
};

function timeAgo(iso: string): string {
  const diffMin = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diffMin < 1) return "à l'instant";
  if (diffMin < 60) return `Il y a ${diffMin} min`;
  const diffH = Math.floor(diffMin / 60);
  if (diffH < 24) return `Il y a ${diffH}h`;
  const diffJ = Math.floor(diffH / 24);
  if (diffJ === 1) return "Hier";
  if (diffJ < 7) return `Il y a ${diffJ}j`;
  return new Date(iso).toLocaleDateString("fr-FR");
}

const NAV_URLS: Record<string, string> = {
  dashboard: "/client/dashboard",
  missions: "/client/missions",
  messages: "/client/messages",
  propositions: "/client/propositions",
  paiements: "/client/paiements",
  offres: "/client/offres",
  "devis-contrats": "/client/devis-contrats",
};

// "missions" et "messages" ont leur propre page dédiée (/client/missions, /client/messages
// — voir MesMissions/Messagerie) et ne sont jamais passés ici : les seules valeurs
// réellement utilisées par les pages wrapper sont dashboard/propositions/paiements/offres/
// devis-contrats. "devis-contrats" n'est pas un item de sidebar plat (CLIENT_NAV) — on y
// accède uniquement via le bloc « Documents Contractuels » (voir DashboardLayout).
type ClientNav = "dashboard" | "propositions" | "paiements" | "offres" | "devis-contrats";

export default function ClientDashboardPage({ initialNav = "dashboard" }: { initialNav?: ClientNav } = {}) {
  const { data: session, status } = useSession() as { data: Session | null; status: string };
  const router = useRouter();
  const currentUserId = (session?.user as { id?: string })?.id ?? "";
  const nav = initialNav;
  const goTo = (id: string) => router.push(NAV_URLS[id] ?? NAV_URLS.dashboard);
  // Données réelles du dashboard client : identité (prénom/nom depuis la DB, absents de la
  // session JWT) + agrégats + missions, en une seule requête — même modèle que
  // provider-summary côté prestataire.
  const [summary, setSummary] = useState<ClientSummary | null>(null);
  // Badges du sidebar pilotés par les événements réels (messages non lus, notifications
  // in-app, propositions reçues, paiements en séquestre) — polling 30s (useSidebarBadges).
  const badgeCounts = useSidebarBadges("client");

  useEffect(() => { if (status === "unauthenticated") router.push("/signin"); }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetchDedupe("/api/dashboard/client-summary")
      .then(r => r.ok ? r.json() : null)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [status]);

  // Identité réelle (sidebar) — chargée UNE fois au niveau racine (UserIdentityProvider), PAS
  // à chaque clic de rubrique. Photo via /api/users/me (null si absente → initiales). Appelée
  // AVANT les retours conditionnels : les hooks doivent rester inconditionnels (rules-of-hooks).
  const identity = useUserIdentity();

  if (status === "loading") return <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center"><div className="w-8 h-8 border-[3px] border-[#FF7A00] border-t-transparent rounded-full animate-spin" /></div>;
  if (status === "unauthenticated") return null;

  const user: DashboardUser = identity
    ? { initials: identity.initials, name: identity.name, role: "Cliente", avatarGradient: "from-[#FF7A00] to-[#E8112D]", avatarUrl: identity.avatarUrl ?? null, id: identity.id }
    : { ...USER, avatarUrl: null, id: currentUserId };
  const all = summary?.missions ?? [];
  const stats = summary?.stats;
  const actives = all.filter(m => !["brouillon", "publiee", "cloturee"].includes(m.status));
  const enCours = actives.length;
  const livraison = all.filter(isEnRevision).length;

  return (
    <DashboardLayout mode="client" user={user} navItems={CLIENT_NAV} activeNav={nav} onNavChange={goTo} badgeCounts={badgeCounts}
      title={nav==="propositions"?"Tableau de bord / Propositions":nav==="paiements"?"Tableau de bord / Paiements":nav==="offres"?"Tableau de bord / Offres":nav==="devis-contrats"?"Tableau de bord / Devis & Contrats":"Tableau de bord"}
    >
      {nav==="offres" && <ClientOffresPanel />}

      {nav==="devis-contrats" && <DevisContratsSection viewer="client" />}

      {nav==="propositions" && <ClientPropositionsSection />}
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
          <div><h1 className="text-[22px] md:text-[26px] font-bold text-[#0A1931]">Bonjour {summary?.user?.firstName ?? ""} 👋</h1><p className="text-[13px] text-zinc-500 mt-1"><span className="text-[#FF7A00]">✦</span> Tu as <span className="font-semibold text-[#FF7A00]">{livraison} livraison{livraison>1?"s":""} à valider</span> • {enCours} mission{enCours>1?"s":""} active{enCours>1?"s":""}</p></div>
          <div className="flex items-center gap-2"><Link href="/missions/new" className="h-9 px-4 rounded-full bg-[#008751] text-white text-[13px] font-semibold flex items-center hover:brightness-110" style={{textDecoration:"none"}}>+ Mission</Link><Link href="/recherche" className="h-9 px-4 rounded-full bg-white border border-gray-200 text-[13px] font-medium text-zinc-600 hover:bg-gray-50" style={{textDecoration:"none"}}>Trouver un talent</Link></div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
          {[{l:"Missions actives",v:stats?String(stats.active):"—",s:stats?`${stats.total} au total`:"",c:"from-[#3B82F6] to-[#3B82F6]"},{l:"Budget dépensé",v:stats?stats.budgetSpent.toLocaleString("fr-FR"):"—",s:"FCFA total",c:"from-[#22C55E] to-[#22C55E]"},{l:"Propositions",v:stats?String(stats.totalProposals):"—",s:"reçues — voir tout →",c:"from-[#8B5CF6] to-[#8B5CF6]",action:()=>goTo("propositions")},{l:"Clôturées",v:stats?String(stats.closed):"—",s:"missions terminées",c:"from-[#EF4444] to-[#EF4444]"}].map(s=><div key={s.l} onClick={s.action} className={`bg-white rounded-[16px] border border-gray-100 p-4 hover:shadow-md transition-shadow relative overflow-hidden ${s.action?"cursor-pointer":""}`}><div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${s.c}`}/><div className="text-[11px] uppercase tracking-widest text-zinc-400 font-semibold mb-1">{s.l}</div><div className="text-[28px] font-bold text-[#0A1931]">{s.v}</div><div className="text-[12px] text-zinc-400 mt-0.5">{s.s}</div></div>)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          <div className="lg:col-span-2"><div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden"><div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between"><h3 className="font-semibold text-[15px] text-[#0A1931]">Mes Missions récentes</h3>{all.length>0&&<button onClick={()=>goTo("missions")} className="text-[12px] font-medium text-[#FF7A00] hover:underline">Voir tout →</button>}</div><div className="divide-y divide-gray-50">{all.length===0?<div className="px-5 py-12 text-center"><div className="text-3xl mb-2">📋</div><p className="text-[13px] text-zinc-500 font-medium">Aucune mission</p><Link href="/missions/new" className="mt-4 inline-flex h-9 px-5 rounded-full bg-[#FF7A00] text-white text-[12px] font-semibold items-center" style={{textDecoration:"none"}}>+ Nouvelle mission</Link></div>:all.slice(0,5).map(m=>{const st=MISSION_STATUS_STYLE[m.status as keyof typeof MISSION_STATUS_STYLE]??MISSION_STATUS_STYLE.brouillon;return <Link key={m.id} href={`/missions/${m.id}/contract`} className="flex items-center gap-3 px-5 py-4 hover:bg-gray-50/50 transition-colors" style={{textDecoration:"none",color:"inherit"}}><div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0A1931] to-[#FF7A00] flex items-center justify-center text-white text-[12px] font-bold shrink-0">{m.titre.slice(0,2).toUpperCase()}</div><div className="flex-1 min-w-0"><div className="text-[13px] font-medium text-[#0A1931]">{m.titre}</div><div className="text-[11px] text-zinc-400">{m.budget.toLocaleString("fr-FR")} {m.currency}</div></div><span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-gray-100 text-zinc-600"><span className={`w-1.5 h-1.5 rounded-full ${st.dot}`}/>{st.label}</span></Link>})}</div><div className="px-5 py-3 bg-gray-50/50 border-t border-gray-50 flex items-center gap-4 text-[11px] text-zinc-500"><span>Paiement sécurisé via</span><div className="flex items-center gap-3"><span className="flex items-center gap-1"><span className="w-5 h-5 rounded-full bg-yellow-400 flex items-center justify-center text-[10px] font-bold text-white">M</span>MTN MoMo</span><span className="flex items-center gap-1"><span className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-[10px] font-bold text-white">W</span>Wave</span><span className="flex items-center gap-1"><span className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center text-[10px] font-bold text-white">O</span>Orange</span></div></div></div></div>
          <div><div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden mb-4"><div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between"><h3 className="font-semibold text-[14px] text-[#0A1931]">Activité récente</h3></div><div className="px-5 py-4 space-y-3">{!summary?<div className="py-2 text-center text-[12px] text-zinc-400">Chargement…</div>:summary.activity.length===0?<div className="py-2 text-center text-[12px] text-zinc-400">Aucune activité récente.</div>:summary.activity.slice(0,4).map(a=><div key={a.id} className="flex gap-3"><div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">{a.icon}</div><div><p className="text-[12px] font-medium text-[#0A1931]">{a.message}</p><p className="text-[11px] text-zinc-400">{timeAgo(a.createdAt)}</p></div></div>)}</div></div>
<div className="mt-4 bg-white rounded-[20px] border border-gray-100 p-4"><div className="flex items-center gap-2 mb-1"><span className="text-green-500 text-lg">🛡️</span><span className="font-semibold text-[13px] text-[#0A1931]">Paiement sécurisé</span></div><p className="text-[12px] text-zinc-500 leading-relaxed">Tes fonds sont bloqués jusqu&apos;à validation. Remboursement garanti.</p></div></div>
        </div>
      </>}
    </DashboardLayout>
  );
}
