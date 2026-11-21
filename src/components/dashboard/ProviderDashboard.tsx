"use client";

// Tableau de bord PRESTATAIRE — un seul composant pour les quatre filières (2026-11-09).
//
// Il y en avait quatre (ExpertDigital, ExpertBtp, Artisan, Manoeuvre), presque identiques ;
// seul celui de l'expert digital lisait les vraies données (/api/dashboard/provider-summary,
// pourtant écrit pour les quatre). Les trois autres affichaient des chiffres et des listes
// inventés (« 124 000 FCFA », « 4.8★ », « 6 chantiers »), un « Wallet » avec un bouton
// « Retirer » — alors que la plateforme ne détient aucun solde — et des boutons sans action.
// Chaque filière garde ici ce qui lui est réellement propre (FILIERES) : son libellé et sa
// carte d'information.
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
import { ProviderProfileCompletionCard } from "@/components/dashboard/ProviderProfileCompletionCard";
import DevisContratsSection from "@/components/dashboard/DevisContratsSection";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { useUserIdentity } from "@/components/user-identity";
import { providerUrl, type ProviderRoleSlug } from "@/lib/provider-urls";
import { PROVIDER_ROLE_LABELS } from "@/lib/provider-options";
import type { Session } from "next-auth";
import { ApplicationsTrackingCard } from "@/components/dashboard/ApplicationsTrackingCard";
import { timeAgo } from "@/lib/time-ago";
import { formatBudget } from "@/lib/budget-format";
import { PendingApplicationsCard } from "@/components/dashboard/PendingApplicationsCard";
import { CheckCircle2, Search, Send, TrendingUp, Wallet } from "lucide-react";
import { Badge, MissionCard, PageHero, PrimaryLink, StatTile } from "@/components/dashboard/proto-ui";

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

function formatMoney(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n));
}

type Filiere = {
  /** Clé de rôle (User.role) — libellé via PROVIDER_ROLE_LABELS. */
  role: keyof typeof PROVIDER_ROLE_LABELS;
  initials: string;
  avatarGradient: string;
  /** Carte d'information propre à la filière (colonne de droite). */
  Aside?: () => React.ReactElement;
};

function GarantsLines() {
  const identity = useUserIdentity();
  // « Requis » uniquement si l'Admin KYC a activé l'exigence sur ce compte
  // (User.garantRequired, défaut OFF) — sinon le garant reste une option.
  return (
    <>
      {identity?.garantRequired ? (
        <div className="flex items-center gap-2 p-2 rounded-xl bg-red-50"><span className="w-2 h-2 rounded-full bg-red-500" /> Garant principal — <span className="font-semibold text-red-700">Requis</span></div>
      ) : (
        <div className="flex items-center gap-2 p-2 rounded-xl bg-gray-50"><span className="w-2 h-2 rounded-full bg-gray-400" /> Garant principal — <span className="text-zinc-500">Optionnel</span></div>
      )}
      <div className="flex items-center gap-2 p-2 rounded-xl bg-gray-50"><span className="w-2 h-2 rounded-full bg-gray-400" /> Garants optionnels (2)</div>
    </>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50"><h3 className="font-semibold text-[14px] text-[#191224]">{title}</h3></div>
      <div className="px-5 py-4 space-y-2 text-[12px]">{children}</div>
    </div>
  );
}

const FILIERES: Record<ProviderRoleSlug, Filiere> = {
  "expert-digital": { role: "expert_digital", initials: "PI", avatarGradient: "from-[#4C1D95] to-[#8B5CF6]" },
  "expert-btp": {
    role: "expert_btp_autres",
    initials: "EN",
    avatarGradient: "from-[#FCD116] to-[#B42318]",
    Aside: () => (
      <InfoCard title="Modes de devis">
        <div className="p-3 rounded-xl bg-amber-50"><span className="font-semibold text-amber-800">A — Rapide</span><p className="text-[11px] text-amber-700 mt-1">Prix fixe, sans visite préalable.</p></div>
        <div className="p-3 rounded-xl bg-blue-50"><span className="font-semibold text-blue-800">B — Standard</span><p className="text-[11px] text-blue-700 mt-1">Visite incluse, devis détaillé.</p></div>
        <div className="p-3 rounded-xl bg-purple-50"><span className="font-semibold text-purple-800">C — Complexe</span><p className="text-[11px] text-purple-700 mt-1">Gros œuvre, jalons multiples.</p></div>
      </InfoCard>
    ),
  },
  artisan: {
    role: "artisan",
    initials: "AR",
    avatarGradient: "from-[#B42318] to-[#FCD116]",
    Aside: () => (
      <InfoCard title="Garants">
        <GarantsLines />
      </InfoCard>
    ),
  },
  manoeuvre: {
    role: "manoeuvre",
    initials: "MA",
    avatarGradient: "from-[#4C1D95] to-[#191224]",
    Aside: () => (
      <InfoCard title="📸 Pointage GPS">
        <div className="p-3 rounded-xl bg-green-50"><span className="font-semibold text-green-800">Outil de preuve</span><p className="text-[11px] text-green-700 mt-1">Horodatage arrivée/départ + photo. Preuve entre vous et le client.</p></div>
        <GarantsLines />
      </InfoCard>
    ),
  },
};

export default function ProviderDashboard({ slug, initialNav = "dashboard" }: { slug: ProviderRoleSlug; initialNav?: string }) {
  const { data: session, status } = useSession() as { data: Session | null; status: string };
  const router = useRouter();
  const currentUserId = (session?.user as { id?: string })?.id ?? "";
  const [summary, setSummary] = useState<Summary | null>(null);
  useEffect(() => { if (status === "unauthenticated") router.push("/signin"); }, [status, router]);
  useEffect(() => { if (status === "authenticated") fetchDedupe("/api/dashboard/provider-summary").then(r => r.ok ? r.json() : null).then(setSummary).catch(() => setSummary(null)); }, [status]);
  if (status === "loading") return <div className="min-h-screen bg-[#F6F5FA] flex items-center justify-center"><div className="w-8 h-8 border-[3px] border-[#6D28D9] border-t-transparent rounded-full animate-spin" /></div>;
  if (status === "unauthenticated") return null;

  return <ProviderDashboardContent slug={slug} nav={initialNav} currentUserId={currentUserId} summary={summary} />;
}

function ProviderDashboardContent({ slug, nav, currentUserId, summary }: { slug: ProviderRoleSlug; nav: string; currentUserId: string; summary: Summary | null }) {
  const filiere = FILIERES[slug];
  const roleLabel = PROVIDER_ROLE_LABELS[filiere.role];
  const missionsHref = providerUrl(slug, "missions");
  // Identité réelle partagée — chargée UNE fois au niveau racine (UserIdentityProvider), PAS
  // à chaque clic de rubrique. Photo via /api/users/me (avatarUrl null si absente → initiales).
  const identity = useUserIdentity();
  const user: DashboardUser = identity
    ? { initials: identity.initials, name: identity.name, role: roleLabel, avatarGradient: filiere.avatarGradient, avatarUrl: identity.avatarUrl ?? null, id: identity.id }
    : { initials: filiere.initials, name: "…", role: roleLabel, avatarGradient: filiere.avatarGradient, avatarUrl: null, id: currentUserId };

  const stats = summary?.stats;
  const statCards = [
    { icon: <CheckCircle2 />, label: "Missions complétées", value: stats ? String(stats.missionsCompleted) : "—", sub: stats ? `+${stats.missionsCompletedThisMonth} ce mois` : "", color: "from-[#22C55E] to-[#22C55E]" },
    { icon: <Wallet />, label: "Revenus totaux", value: stats ? formatMoney(stats.revenueTotal) : "—", sub: stats ? `${formatMoney(stats.revenueThisMonth)} FCFA ce mois` : "", color: "from-[#3B82F6] to-[#3B82F6]" },
    { icon: <Send />, label: "Candidatures", value: stats ? String(stats.pendingProposals) : "—", sub: "en cours", color: "from-[#8B5CF6] to-[#8B5CF6]" },
    { icon: <TrendingUp />, label: "Taux de succès", value: stats?.successRate != null ? `${stats.successRate}%` : "—", sub: "candidatures acceptées", color: "from-[#6D28D9] to-[#6D28D9]" },
  ];

  return (
    <DashboardLayout user={user} navItems={providerNav(slug)} activeNav={nav}
      title="Tableau de bord" solde={summary ? summary.stats.revenueTotal.toLocaleString("fr-FR") : "0"}
    >
      {nav === "messages" ? (
        <Messagerie currentUserId={currentUserId} />
      ) : nav === "missions" ? (
        <MissionsSection role={slug} />
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
      {/* Welcome — en-tête du prototype */}
      <PageHero
        kicker={<>Bonjour{summary?.user.name ? `, ${summary.user.name}` : ""} · Espace prestataire</>}
        title={<>Candidatez, livrez,<br />soyez payé en sécurité.</>}
        subtitle={summary ? (
          <>Tu as <span className="font-semibold text-[#4C1D95]">{summary.newMissionsToday} nouvelle{summary.newMissionsToday !== 1 ? "s" : ""} mission{summary.newMissionsToday !== 1 ? "s" : ""}</span> aujourd&apos;hui • {summary.stats.pendingProposals} en attente de réponse. Chaque jalon validé est versé depuis l&apos;escrow.</>
        ) : "Chargement…"}
        actions={<PrimaryLink href={missionsHref}><Search className="w-4 h-4" aria-hidden /> Trouver une mission</PrimaryLink>}
      />

      {/* Carte de complétion (P5) — le pourcentage vient du serveur, elle se replie d'elle-même.
          Montée AVANT les cartes statistiques : tant que le profil est incomplet, c'est l'action
          utile, pas un chiffre de plus. */}
      <ProviderProfileCompletionCard />

      {/* Candidatures enregistrées faute de KYC vérifié : à envoyer dès la vérification. */}
      <PendingApplicationsCard />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 mb-6">
        {statCards.map((s) => (
          <StatTile key={s.label} icon={s.icon} value={s.value} label={s.label} sub={s.sub || undefined} />
        ))}
      </div>

      {/* État et suivi des candidatures envoyées (src/components/dashboard/ApplicationsTrackingCard.tsx) */}
      <ApplicationsTrackingCard viewer="provider" seeAllHref={providerUrl(slug, "candidatures")} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        {/* LEFT — Missions disponibles */}
        <div className="lg:col-span-2 space-y-4">
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display font-bold text-[18px] text-[#191224]">Missions recommandées</h2>
              <Link href={missionsHref} className="text-[13px] font-bold text-[#4C1D95] hover:underline">Voir tout →</Link>
            </div>
            {!summary ? (
              <div className="rounded-3xl border border-[#E7E2F0] bg-white px-5 py-8 text-center text-[13px] text-[#9A93A8]">Chargement…</div>
            ) : summary.recommended.length === 0 ? (
              <div className="rounded-3xl border border-dashed border-[#D4CCE3] bg-white px-5 py-8 text-center text-[13px] text-[#6B6478]">Aucune mission ouverte dans ton domaine pour le moment.</div>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {summary.recommended.map((m) => (
                  <MissionCard
                    key={m.id}
                    href={missionsHref}
                    primaryLabel="Candidater"
                    title={m.titre}
                    category={m.domaine}
                    place={m.country || null}
                    badges={<><Badge tone="success">Ouverte</Badge><Badge tone="muted">{m.delaiJours} j</Badge></>}
                    amount={formatBudget(m.budget, m.currency, m.budgetType)}
                    meta={m.client}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Mes missions en cours */}
          <div className="bg-white rounded-[20px] border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-[14px] text-[#191224]">Missions en cours</h3>
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
                      <div className="text-[13px] font-medium text-[#191224]">{m.titre}</div>
                      <div className="text-[11px] text-zinc-400">{m.client} • {m.budget.toLocaleString("fr-FR")} {m.currency} • Échéance {new Date(m.echeance).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</div>
                    </div>
                    <span className="text-[12px] font-bold text-[#047857]">{m.progress}%</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#EFEAF8] overflow-hidden">
                    <div className="h-full rounded-full bg-[#047857]" style={{ width: `${m.progress}%` }} />
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
              <h3 className="font-semibold text-[14px] text-[#191224]">Activité récente</h3>
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
                    <p className="text-[12px] font-medium text-[#191224]">{a.message}</p>
                    <p className="text-[11px] text-zinc-400">{timeAgo(a.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
            )}
          </div>

          {filiere.Aside && <filiere.Aside />}

          {/* Revenus totaux — pas de "wallet" : la plateforme instruit des paiements PSP mais
              ne détient jamais de solde interne (voir prisma/schema.prisma, PspEscrowOperation).
              Ce chiffre est la somme réelle des paiements confirmés reçus, pas un solde
              retirable — donc pas de bouton "Retirer" ici. */}
          <div className="bg-[#191224] rounded-[20px] p-5 text-white">
            <div className="text-[11px] text-white/60 font-semibold uppercase tracking-widest mb-1">Revenus totaux</div>
            <div className="font-display text-[28px] font-extrabold tracking-tight">{summary ? summary.stats.revenueTotal.toLocaleString("fr-FR") : "—"} FCFA</div>
            <div className="text-[11px] text-white/40 mt-1">Reçus au total via paiement sécurisé</div>
            <Link href={missionsHref} className="mt-3 inline-flex h-9 px-4 rounded-full bg-white/10 text-white text-[12px] font-medium items-center hover:bg-white/20 transition-colors" style={{ textDecoration: "none" }}>Voir mes missions</Link>
          </div>
        </div>
      </div>
      </>
      )}
    </DashboardLayout>
  );
}
