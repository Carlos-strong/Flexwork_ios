"use client";
import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DashboardLayout, { providerNav, type DashboardUser } from "@/components/dashboard/DashboardLayout";
import Messagerie from "@/components/dashboard/Messagerie";
import MissionsSection from "@/components/dashboard/provider/MissionsSection";
import CandidaturesSection from "@/components/dashboard/provider/CandidaturesSection";
import OffresSection from "@/components/dashboard/provider/OffresSection";
import WalletSection from "@/components/dashboard/provider/WalletSection";
import DevisContratsSection from "@/components/dashboard/DevisContratsSection";
import { useSidebarBadges } from "@/components/dashboard/useSidebarBadges";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { useUserIdentity } from "@/components/user-identity";
import { providerUrl } from "@/lib/provider-urls";
import type { Session } from "next-auth";

type Summary = {
  user: { name: string; initials: string; avatarUrl: string | null };
  stats: {
    missionsCompleted: number;
    missionsCompletedThisMonth: number;
    revenueTotal: number;
    revenueThisMonth: number;
    pendingProposals: number;
    successRate: number | null;
  };
  newMissionsToday: number;
  recommended: Array<{ id: string; titre: string; domaine: string; budget: number; currency: string; budgetType: string | null; delaiJours: number; client: string; country: string | null }>;
  inProgress: Array<{ id: string; titre: string; client: string; budget: number; currency: string; progress: number; echeance: string }>;
  activity: Array<{ id: string; message: string; icon: string; createdAt: string }>;
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

function formatMoney(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
}

export default function ExpertDigitalDashboard({ initialNav = "dashboard" }: { initialNav?: string } = {}) {
  const { data: session, status } = useSession() as { data: Session | null; status: string };
  const router = useRouter();
  // Navigation pilotée par URL (pattern client) : la section active vient du path, chaque
  // clic dans le sidebar change l'URL via goTo().
  const nav = initialNav;
  const goTo = (id: string) => router.push(providerUrl("expert-digital", id));
  const currentUserId = (session?.user as { id?: string })?.id ?? "";
  // Badges du sidebar pilotés par les événements réels (messages non lus, notifications
  // in-app, nouvelles missions, candidatures) — polling 30s, voir useSidebarBadges.
  const badgeCounts = useSidebarBadges("prestataire");
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => { if (status === "unauthenticated") router.push("/signin"); }, [status, router]);
  useEffect(() => { if (status === "authenticated") fetchDedupe("/api/dashboard/provider-summary").then(r => r.ok ? r.json() : null).then(setSummary).catch(() => setSummary(null)); }, [status]);
  if (status === "loading") return <div className="min-h-screen bg-[#FFF8F0] flex items-center justify-center"><div className="w-8 h-8 border-[3px] border-[#FF7A00] border-t-transparent rounded-full animate-spin" /></div>;
  if (status === "unauthenticated") return null;

  return <ProviderDashboard nav={nav} setNav={goTo} currentUserId={currentUserId} badgeCounts={badgeCounts} summary={summary} />;
}

// Shared Prestataire dashboard content
function ProviderDashboard({ nav, setNav, currentUserId, badgeCounts, summary }: { nav: string; setNav: (id: string) => void; currentUserId: string; badgeCounts: Record<string, number>; summary: Summary | null }) {
  // Identité réelle partagée — chargée UNE fois au niveau racine (UserIdentityProvider), PAS
  // à chaque clic de rubrique. Photo via /api/users/me (avatarUrl null si absente → initiales).
  const identity = useUserIdentity();
  const user: DashboardUser = identity
    ? { initials: identity.initials, name: identity.name, role: "Expert Digital", avatarGradient: "from-[#008751] to-[#FCD116]", avatarUrl: identity.avatarUrl ?? null, id: identity.id }
    : { initials: "ED", name: "…", role: "Expert Digital", avatarGradient: "from-[#008751] to-[#FCD116]", avatarUrl: null, id: currentUserId };

  const stats = summary?.stats;
  const statCards = [
    { label: "Missions complétées", value: stats ? String(stats.missionsCompleted) : "—", sub: stats ? `+${stats.missionsCompletedThisMonth} ce mois` : "", color: "from-[#22C55E] to-[#22C55E]" },
    { label: "Revenus totaux", value: stats ? formatMoney(stats.revenueTotal) : "—", sub: stats ? `${formatMoney(stats.revenueThisMonth)} FCFA ce mois` : "", color: "from-[#3B82F6] to-[#3B82F6]" },
    { label: "Candidatures", value: stats ? String(stats.pendingProposals) : "—", sub: "en cours", color: "from-[#8B5CF6] to-[#8B5CF6]" },
    { label: "Taux de succès", value: stats?.successRate != null ? `${stats.successRate}%` : "—", sub: "candidatures acceptées", color: "from-[#FF7A00] to-[#FF7A00]" },
  ];

  return (
    <DashboardLayout mode="prestataire" user={user} navItems={providerNav("expert-digital")} activeNav={nav} onNavChange={setNav}
      title="Tableau de bord" solde={summary ? summary.stats.revenueTotal.toLocaleString("fr-FR") : "0"} badgeCounts={badgeCounts}
    >
      {nav === "messages" ? (
        <Messagerie currentUserId={currentUserId} />
      ) : nav === "missions" ? (
        <MissionsSection role="expert-digital" />
      ) : nav === "candidatures" ? (
        <CandidaturesSection />
      ) : nav === "offres" ? (
        <OffresSection />
      ) : nav === "devis-contrats" ? (
        <DevisContratsSection viewer="provider" />
      ) : nav === "wallet" ? (
        <WalletSection />
      ) : (
      <>
      {/* Welcome */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-[22px] md:text-[26px] font-bold text-[#0A1931] tracking-tight">Bonjour {summary?.user.name ?? ""} 👋</h1>
          <p className="text-[13px] text-zinc-500 mt-1">
            <span className="text-[#FF7A00]">✦</span>{" "}
            {summary ? (
              <>Tu as <span className="font-semibold text-[#FF7A00]">{summary.newMissionsToday} nouvelle{summary.newMissionsToday !== 1 ? "s" : ""} mission{summary.newMissionsToday !== 1 ? "s" : ""}</span> aujourd&apos;hui • {summary.stats.pendingProposals} en attente de réponse</>
            ) : "Chargement…"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button className="h-9 px-4 rounded-full bg-white border border-gray-200 text-[13px] font-medium text-zinc-600 hover:bg-gray-50 transition-colors">Filtres</button>
          <button className="h-9 px-4 rounded-full bg-white border border-gray-200 text-[13px] font-medium text-zinc-600 hover:bg-gray-50 transition-colors">Calendrier</button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-6">
        {statCards.map((s) => (
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
              <Link href="/dashboard/expert-digital/missions" className="text-[12px] font-medium text-[#FF7A00] hover:underline">Voir tout →</Link>
            </div>
            {!summary ? (
              <div className="px-5 py-8 text-center text-[13px] text-zinc-400">Chargement…</div>
            ) : summary.recommended.length === 0 ? (
              <div className="px-5 py-8 text-center text-[13px] text-zinc-400">Aucune mission ouverte dans ton domaine pour le moment.</div>
            ) : (
            <div className="divide-y divide-gray-50">
              {summary.recommended.map((m) => (
                <Link key={m.id} href="/dashboard/expert-digital/missions" className="flex items-center gap-3 px-5 py-4 hover:bg-gray-50/50 transition-colors cursor-pointer" style={{ textDecoration: "none", color: "inherit" }}>
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#FF7A00] to-[#E8112D] flex items-center justify-center text-white text-[12px] font-bold shrink-0">{m.domaine.slice(0,2).toUpperCase()}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium text-[#0A1931]">{m.titre}</div>
                    <div className="text-[11px] text-zinc-400">{m.country && <span className="text-[#008751] font-medium">{m.country} • </span>}{m.client} • {m.domaine} • {m.delaiJours}j</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[13px] font-semibold text-[#0A1931]">{m.budgetType === "QUOTE" ? "Sur devis" : `${m.budget.toLocaleString("fr-FR")} ${m.currency}`}</div>
                    <span className="mt-1 inline-block h-7 px-3 rounded-full bg-[#008751] text-white text-[10px] font-semibold leading-7">Candidater</span>
                  </div>
                </Link>
              ))}
            </div>
            )}
          </div>

          {/* Mes missions en cours */}
          <div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-[14px] text-[#0A1931]">Missions en cours</h3>
                {summary && summary.inProgress.length > 0 && <span className="px-1.5 py-0.5 rounded-full bg-[#22C55E] text-white text-[10px] font-bold">{summary.inProgress.length}</span>}
              </div>
            </div>
            {!summary ? (
              <div className="px-5 py-8 text-center text-[13px] text-zinc-400">Chargement…</div>
            ) : summary.inProgress.length === 0 ? (
              <div className="px-5 py-8 text-center text-[13px] text-zinc-400">Aucune mission en cours pour l&apos;instant.</div>
            ) : (
            <div className="divide-y divide-gray-50">
              {summary.inProgress.map((m) => (
                <div key={m.id} className="px-5 py-4">
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <div className="text-[13px] font-medium text-[#0A1931]">{m.titre}</div>
                      <div className="text-[11px] text-zinc-400">{m.client} • {m.budget.toLocaleString("fr-FR")} {m.currency} • Échéance {new Date(m.echeance).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</div>
                    </div>
                    <span className="text-[12px] font-bold text-[#008751]">{m.progress}%</span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden">
                    <div className="h-full rounded-full bg-[#008751]" style={{ width: `${m.progress}%` }} />
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>
        </div>

        {/* RIGHT — Activité & Revenus */}
        <div className="space-y-4">
          <div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50">
              <h3 className="font-semibold text-[14px] text-[#0A1931]">Activité récente</h3>
            </div>
            {!summary ? (
              <div className="px-5 py-8 text-center text-[13px] text-zinc-400">Chargement…</div>
            ) : summary.activity.length === 0 ? (
              <div className="px-5 py-8 text-center text-[13px] text-zinc-400">Aucune activité récente.</div>
            ) : (
            <div className="px-5 py-4 space-y-3">
              {summary.activity.map((a) => (
                <div key={a.id} className="flex gap-3">
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center shrink-0">{a.icon}</div>
                  <div>
                    <p className="text-[12px] font-medium text-[#0A1931]">{a.message}</p>
                    <p className="text-[11px] text-zinc-400">{timeAgo(a.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>

          {/* Revenus totaux — pas de "wallet" : la plateforme instruit des paiements PSP mais
              ne détient jamais de solde interne (voir prisma/schema.prisma, PspEscrowOperation).
              Ce chiffre est la somme réelle des paiements confirmés reçus, pas un solde
              retirable — donc pas de bouton "Retirer" ici. */}
          <div className="bg-[#0A1931] rounded-[20px] p-5 text-white">
            <div className="text-[11px] text-white/60 font-semibold uppercase tracking-widest mb-1">Revenus totaux</div>
            <div className="text-[28px] font-bold tracking-tight">{summary ? summary.stats.revenueTotal.toLocaleString("fr-FR") : "—"} FCFA</div>
            <div className="text-[11px] text-white/40 mt-1">Reçus au total via paiement sécurisé</div>
            <Link href="/dashboard/expert-digital/missions" className="mt-3 inline-flex h-9 px-4 rounded-full bg-white/10 text-white text-[12px] font-medium items-center hover:bg-white/20 transition-colors" style={{ textDecoration: "none" }}>Voir mes missions</Link>
          </div>
        </div>
      </div>
      </>
      )}
    </DashboardLayout>
  );
}
