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
import { Suspense, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertCircle, ArrowLeft, FileText, Plus, ShieldCheck, User } from "lucide-react";
import { FilterChips, PageHero, PrimaryLink, StatTile } from "@/components/dashboard/proto-ui";
import { MissionGroupCard, groupProgress, type GroupCardModel } from "@/components/dashboard/MissionGroupCard";
import { groupAnnonces, groupFilterTags, type MissionGroup } from "@/lib/annonce-groups";
import { personFullName } from "@/lib/person-name";
import { weightedJalonsProgress } from "@/lib/jalons";
import DashboardLayout, { CLIENT_NAV, type DashboardUser } from "@/components/dashboard/DashboardLayout";
import ClientOffresPanel from "@/components/dashboard/gig/ClientOffresPanel";
import ClientPropositionsSection from "@/components/dashboard/client/PropositionsSection";
import ClientPaiementsSection from "@/components/dashboard/client/PaiementsSection";
import DevisContratsSection from "@/components/dashboard/DevisContratsSection";
import { ClientProfileCompletionButton } from "@/components/dashboard/ClientProfileCompletionCard";
import { PendingPublicationsCard } from "@/components/dashboard/PendingPublicationsCard";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { useUserIdentity } from "@/components/user-identity";
import type { Session } from "next-auth";

type Mission = { id: string; titre: string; status: string; budget: number; currency: string; domaine?: string | null; ville?: string | null; observedProgress?: number; parentMissionId?: string | null; maxCandidatures?: number | null; _count?: { proposals: number }; contract?: { jalons: { status: string; montant: number; observedProgress: number }[] } | null; proposals?: { provider: { firstname: string | null; lastname: string | null } }[] };

// Filtres de la maquette (2026-11-11) : regroupement des statuts réels de Mission.status.
const FILTERS = ["Toutes", "Publiées", "En cours", "Terminées", "En litige"] as const;
type Filter = (typeof FILTERS)[number];
// Une annonce et ses engagements = une carte (src/lib/annonce-groups.ts).
function toCard(g: MissionGroup<Mission>): GroupCardModel {
  const m = g.mission;
  const engagements = g.engagements.map((e) => ({
    id: e.id,
    status: e.status,
    providerName: e.proposals?.[0] ? personFullName(e.proposals[0].provider) || null : null,
    progress: progressOf(e),
  }));
  return {
    id: m.id,
    titre: m.titre,
    domaine: m.domaine ?? "",
    ville: m.ville ?? null,
    budget: m.budget,
    currency: m.currency,
    status: m.status,
    candidatures: [m, ...g.engagements].reduce((s, x) => s + (x._count?.proposals ?? 0), 0),
    places: m.parentMissionId ? null : m.maxCandidatures && m.maxCandidatures > 0 ? m.maxCandidatures : 1,
    progress: groupProgress(progressOf(m), engagements),
    toReview: [m, ...g.engagements].some(isEnRevision),
    engagements,
  };
}
// Progression d'une carte — même règle que Mes Missions (MesMissions.tsx, progressOf).
function progressOf(m: Mission): number {
  const jalons = m.contract?.jalons ?? [];
  if (jalons.length > 0) return weightedJalonsProgress(jalons);
  if (m.status === "validee" || m.status === "cloturee") return 100;
  return m.observedProgress ?? 0;
}
const CARDS_SHOWN = 6;

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
  user: { name: string; initials: string; firstName: string; fullName?: string; city?: string | null; avatarUrl: string | null };
  stats: { total: number; active: number; pendingValidations: number; totalProposals: number; budgetSpent: number; closed: number; open: number; inEscrow?: number };
  missions: Mission[];
};

// Repli pendant le chargement — remplacé par l'identité réelle dès que le summary arrive.
const USER: DashboardUser = {
  initials: "CL", name: "Cliente", role: "Cliente",
  avatarGradient: "from-[#6D28D9] to-[#B42318]",
};

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
  const [filter, setFilter] = useState<Filter>("Toutes");

  // Retour à la page demandée après connexion (Gig ouvert depuis l'accueil, lien partagé).
  useEffect(() => {
    if (status === "unauthenticated") {
      router.push(`/signin?callbackUrl=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
  }, [status, router]);

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

  if (status === "loading") return <div className="min-h-screen bg-[#F6F5FA] flex items-center justify-center"><div className="w-8 h-8 border-[3px] border-[#6D28D9] border-t-transparent rounded-full animate-spin" /></div>;
  if (status === "unauthenticated") return null;

  const user: DashboardUser = identity
    ? { initials: identity.initials, name: identity.name, role: "Cliente", avatarGradient: "from-[#6D28D9] to-[#B42318]", avatarUrl: identity.avatarUrl ?? null, id: identity.id }
    : { ...USER, avatarUrl: null, id: currentUserId };
  const all = summary?.missions ?? [];
  const stats = summary?.stats;
  const livraison = all.filter(isEnRevision).length;
  const groups = groupAnnonces(all);
  const shown = filter === "Toutes" ? groups : groups.filter(g => (groupFilterTags(g) as string[]).includes(filter));
  const counts = Object.fromEntries(FILTERS.map(f => [f, f === "Toutes" ? groups.length : groups.filter(g => (groupFilterTags(g) as string[]).includes(f)).length]));

  return (
    <DashboardLayout user={user} navItems={CLIENT_NAV} activeNav={nav}
      title={nav==="propositions"?"Tableau de bord / Propositions":nav==="paiements"?"Tableau de bord / Paiements":nav==="offres"?"Tableau de bord / Offres":nav==="devis-contrats"?"Tableau de bord / Devis & Contrats":"Tableau de bord"}
    >
      {nav==="offres" && <ClientOffresPanel />}

      {nav==="devis-contrats" && <DevisContratsSection viewer="client" />}

      {nav==="propositions" && <ClientPropositionsSection />}
      {nav==="paiements" && <>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={()=>goTo("dashboard")} className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center hover:bg-gray-100"><ArrowLeft className="w-4 h-4 text-zinc-600"/></button>
          <div>
            <h1 className="text-[22px] font-bold text-[#191224]">Paiements</h1>
            <p className="text-[12px] text-zinc-500 mt-0.5">Suis tes paiements et séquestres.</p>
          </div>
        </div>
        <ClientPaiementsSection />
      </>}
      {nav==="dashboard" && <>
        {/* Maquette « Vos missions, protégées par l'escrow » (2026-11-11). */}
        <PageHero
          kicker={<>Bonjour{summary?.user ? `, ${summary.user.fullName || summary.user.firstName}` : ""}{summary?.user?.city ? ` • ${summary.user.city}` : ""}</>}
          title={<>Vos missions,<br />protégées par l&apos;escrow.</>}
          subtitle="Publiez, comparez, contractualisez. Les fonds restent séquestrés jusqu'à validation de chaque jalon."
          actions={<><ClientProfileCompletionButton /><PrimaryLink href="/missions/new"><Plus className="w-5 h-5" aria-hidden /> Créer une annonce</PrimaryLink></>}
        />
        {livraison > 0 && (
          <Link href="/client/missions" className="mb-4 flex items-center gap-2 rounded-2xl bg-[#FFF6E3] px-4 py-3 text-[13px] font-semibold text-[#B45309]" style={{textDecoration:"none"}}>
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden /> {livraison} livraison{livraison>1?"s":""} à valider — les fonds attendent votre décision.
          </Link>
        )}
        {/* Publication bloquée par le KYC, puis « Publier maintenant » une fois vérifié.
            Suspense : la carte lit ?publication=kyc via useSearchParams. */}
        <Suspense fallback={null}>
          <PendingPublicationsCard />
        </Suspense>

        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-5">
          <StatTile icon={<FileText />} value={stats?String(stats.active):"—"} label="Missions actives" />
          <StatTile icon={<User />} value={stats?String(stats.totalProposals):"—"} label="Candidatures" onClick={()=>goTo("propositions")} />
          <StatTile icon={<ShieldCheck />} value={stats?`${(stats.inEscrow ?? 0).toLocaleString("fr-FR")} FCFA`:"—"} label="En escrow" />
        </div>

        <div className="mb-3"><FilterChips options={[...FILTERS]} value={filter} onChange={(v)=>setFilter(v as Filter)} counts={counts} /></div>

        {!summary ? (
          <div className="rounded-3xl border border-[#E7E2F0] bg-white px-5 py-12 text-center text-[13px] text-[#9A93A8]">Chargement…</div>
        ) : all.length===0 ? (
          <div className="rounded-3xl border border-dashed border-[#D4CCE3] bg-white px-5 py-12 text-center">
            <FileText className="w-8 h-8 mx-auto text-[#9A93A8]" aria-hidden />
            <p className="mt-2 text-[14px] text-[#6B6478] font-medium">Aucune mission pour l&apos;instant</p>
            <Link href="/missions/new" className="mt-4 inline-flex px-5 py-2.5 rounded-full bg-[#4C1D95] text-white text-[13px] font-bold items-center gap-1" style={{textDecoration:"none"}}><Plus className="w-4 h-4" aria-hidden /> Créer une annonce</Link>
          </div>
        ) : shown.length===0 ? (
          <p className="p-5 rounded-2xl border border-[#E7E2F0] bg-white text-center text-[14px] text-[#6B6478]">Aucune mission dans ce filtre. <button type="button" className="font-bold underline text-[#191224]" onClick={()=>setFilter("Toutes")}>Tout afficher</button></p>
        ) : (
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
            {/* Une carte par mission publiée ; ses engagements (prestataires retenus) y sont listés. */}
            {shown.slice(0, CARDS_SHOWN).map(g => <MissionGroupCard key={g.mission.id} m={toCard(g)} />)}
          </div>
        )}
        {shown.length > CARDS_SHOWN && (
          <div className="mt-3 text-center"><button type="button" onClick={()=>goTo("missions")} className="text-[13px] font-bold text-[#4C1D95] hover:underline">Voir les {counts[filter]} missions →</button></div>
        )}

        {/* Page volontairement minimale (2026-11-11) : le suivi des candidatures reçues vit sur
            /client/propositions ; la complétion du profil est un bouton de l'en-tête. */}
      </>}
    </DashboardLayout>
  );
}
