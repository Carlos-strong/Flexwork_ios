"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Clock, FileText, Plus, Search } from "lucide-react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { weightedJalonsProgress } from "@/lib/jalons";
import { Badge, FilterChips, MissionCard, PageHero, StatTile } from "@/components/dashboard/proto-ui";
import { groupProgress } from "@/components/dashboard/MissionGroupCard";
import { nextAction, PHASE_LABEL, PHASE_TONE, phaseOf, phaseSummary, type MissionAction, type Phase } from "@/lib/mission-phase";
import { groupAnnonces, type MissionGroup } from "@/lib/annonce-groups";

type ApiMission = {
  id: string;
  titre: string;
  status: string;
  budget: number;
  currency: string;
  domaine?: string;
  delaiJours?: number | null;
  dateExpiration?: string | null;
  // Annonce et engagements (2026-11-10).
  parentMissionId?: string | null;
  maxCandidatures?: number | null;
  observedProgress?: number;
  // Candidatures encore ouvertes (GET /api/missions, 2026-11-11) — « Examiner N candidatures ».
  openCandidatures?: number;
  _count?: { proposals: number; engagements?: number };
  proposals?: { provider: { id: string; firstname: string | null; lastname: string | null; avatarPath: string | null } }[];
  contract?: {
    jalons: { status: string; montant: number; observedProgress: number }[];
    provider: { id: string; firstname: string | null; lastname: string | null; avatarPath: string | null } | null;
  } | null;
};


// PROGRESSION de la liste — avancement GLOBAL de la mission, pondéré par montant sur un
// contrat à jalons (règle 18.14, voir weightedJalonsProgress), ou observedProgress pour un
// contrat sans jalon. Sur un contrat à jalons, mission.observedProgress ne reflète jamais
// l'avancement réel (voir src/lib/psp-webhook.ts) — d'où le repli sur les jalons plutôt que
// ce champ.
function progressOf(m: ApiMission): number {
  const jalons = m.contract?.jalons ?? [];
  if (jalons.length > 0) {
    return weightedJalonsProgress(jalons);
  }
  return m.observedProgress ?? 0;
}


// Même logique de délai que MissionsSection (prestataire) : J-X depuis dateExpiration,
// sinon delaiJours.
function deadlineOf(m: ApiMission): string {
  // Annonce (2026-11-10) : seule sa date limite de candidature fait foi — son délai
  // d'exécution (delaiJours) n'est pas une échéance de l'annonce.
  if (!m.parentMissionId && (m.status === "publiee" || m.status === "annonce_close") && !m.dateExpiration) return "";
  if (m.status === "annonce_close") return "Close";
  if (m.dateExpiration) {
    const days = Math.ceil((new Date(m.dateExpiration).getTime() - Date.now()) / 86400000);
    if (days <= 0) return "Fermée";
    if (days === 1) return "Demain";
    return `J-${days}`;
  }
  if (m.delaiJours) return `J-${m.delaiJours}`;
  return "";
}

// Sur un contrat à jalons, mission.status ne passe jamais à "livrable_soumis" — seul
// jalon.status le fait, jalon par jalon (voir src/lib/psp-webhook.ts). Sans ce repli, une
// mission à jalons restait affichée "En cours" même avec un livrable réellement en attente
// de vérification.
function hasPendingJalon(m: ApiMission): boolean {
  return (m.contract?.jalons.length ?? 0) > 0 && m.contract!.jalons.some((j) => j.status === "livrable_soumis");
}


// ── Suivi et monitoring (2026-11-11) ────────────────────────────────────────────────────────
// Mes Missions est LA page de suivi des missions du client. Chaque mission publiée (une annonce
// et ses engagements, src/lib/annonce-groups.ts) y montre sa phase (src/lib/mission-phase.ts),
// celle de chaque prestataire retenu, et la prochaine action attendue du client, avec son lien.

const FILTERS = ["Toutes", "Actions requises", "Recrutement", "Contrat à signer", "À financer", "En cours", "À valider", "Litige", "Terminées"] as const;
type Filter = (typeof FILTERS)[number];
const FILTER_PHASES: Partial<Record<Filter, Phase[]>> = {
  "Recrutement": ["recrutement"],
  "Contrat à signer": ["contrat"],
  "À financer": ["financement"],
  "En cours": ["en_cours", "garantie"],
  "À valider": ["a_valider"],
  "Litige": ["litige"],
  "Terminées": ["terminee"],
};

type Row = {
  id: string;
  titre: string;
  domaine: string;
  budget: number;
  currency: string;
  phase: Phase;
  engagementPhases: Phase[];
  isAnnonce: boolean;
  places: number;
  candidatures: number;
  progress: number;
  deadline: string;
  action: MissionAction | null;
  search: string;
};

function matchesFilter(row: Row, filter: Filter): boolean {
  if (filter === "Toutes") return true;
  if (filter === "Actions requises") return row.action !== null;
  const phases = FILTER_PHASES[filter] ?? [];
  return [row.phase, ...row.engagementPhases].some((p) => phases.includes(p));
}

function toRow(group: MissionGroup<ApiMission>): Row {
  const m = group.mission;
  const phase = phaseOf(m.status, hasPendingJalon(m));
  // Une exécution terminée (ou en retenue de garantie) est à 100 %, même sans jalon renseigné.
  const progressFor = (x: ApiMission, p: Phase) => (p === "terminee" || p === "garantie" ? 100 : progressOf(x));
  const engagements = group.engagements.map((e) => {
    const p = phaseOf(e.status, hasPendingJalon(e));
    return { id: e.id, phase: p, progress: progressFor(e, p) };
  });
  const isAnnonce = !m.parentMissionId && (m.status === "publiee" || m.status === "annonce_close" || engagements.length > 0);
  return {
    id: m.id,
    titre: m.titre,
    domaine: m.domaine ?? "",
    budget: m.budget,
    currency: m.currency,
    phase,
    engagementPhases: engagements.map((e) => e.phase),
    isAnnonce,
    places: m.maxCandidatures && m.maxCandidatures > 0 ? m.maxCandidatures : 1,
    candidatures: [m, ...group.engagements].reduce((s, x) => s + (x._count?.proposals ?? 0), 0),
    progress: groupProgress(progressFor(m, phase), engagements),
    // Échéance affichée seulement pendant le recrutement (date limite de candidature) : ailleurs,
    // le délai publié n'est pas une échéance réelle et induisait en erreur.
    deadline: phase === "recrutement" ? deadlineOf(m) : "",
    action: nextAction({ id: m.id, phase, pendingCandidatures: m.openCandidatures ?? 0 }, engagements),
    search: [m.titre, m.domaine ?? "", m.id].join(" ").toLowerCase(),
  };
}

export default function MesMissions() {
  const [filter, setFilter] = useState<Filter>("Toutes");
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchDedupe("/api/missions")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (cancelled) return;
        setRows(groupAnnonces((d.items ?? []) as ApiMission[]).map(toRow));
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = rows.filter((r) => (!q || r.search.includes(q)) && matchesFilter(r, filter));
  const counts: Record<string, number> = Object.fromEntries(FILTERS.map((f) => [f, rows.filter((r) => matchesFilter(r, f)).length]));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-[3px] border-[#6D28D9] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="page-width space-y-5">
      <PageHero
        kicker="Espace client · Suivi"
        title="Mes Missions"
        subtitle="Suivez toutes vos missions : recrutement, contrats, séquestre, livrables et litiges — avec, pour chacune, la prochaine action qui vous attend."
        actions={
          <Link
            href="/missions/new"
            className="px-4 py-3 rounded-full text-white font-bold flex items-center gap-2 bg-[#4C1D95] hover:bg-[#3B1578] transition"
            style={{ textDecoration: "none" }}
          >
            <Plus className="w-5 h-5" aria-hidden /> Nouvelle mission
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <StatTile icon={<FileText />} value={counts["Toutes"]} label="Missions" sub="publiées" />
        <StatTile icon={<AlertCircle />} value={counts["Actions requises"]} label="Actions requises" sub="vous êtes attendu" onClick={() => setFilter("Actions requises")} />
        <StatTile icon={<Clock />} value={counts["En cours"]} label="En cours" sub="travail sous séquestre" onClick={() => setFilter("En cours")} />
        <StatTile icon={<CheckCircle2 />} value={counts["Terminées"]} label="Terminées" sub="clôturées" onClick={() => setFilter("Terminées")} />
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <div className="flex-1 min-w-0">
          <FilterChips options={[...FILTERS]} value={filter} onChange={(v) => setFilter(v as Filter)} counts={counts} />
        </div>
        <label className="flex items-center bg-white rounded-full px-4 py-2.5 border border-[#E7E2F0] text-[13px] lg:w-[280px] mb-0 focus-within:border-[#4C1D95]">
          <Search className="w-4 h-4 mr-2 text-[#9A93A8]" aria-hidden />
          <span className="sr-only">Rechercher une mission</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher mission..."
            className="bg-transparent outline-none w-full p-0 placeholder:text-[#9A93A8]"
          />
        </label>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
        {filtered.map((r) => {
          const retenus = r.engagementPhases.length;
          const summary = phaseSummary(r.engagementPhases);
          return (
            <MissionCard
              key={r.id}
              href={`/missions/${r.id}/publique`}
              title={r.titre}
              category={r.domaine}
              deadline={r.deadline || null}
              badges={
                <>
                  <Badge tone={PHASE_TONE[r.phase]}>{PHASE_LABEL[r.phase]}</Badge>
                  {r.isAnnonce && (
                    <Badge tone={retenus >= r.places ? "success" : "info"}>
                      {retenus}/{r.places} retenu{retenus > 1 ? "s" : ""}
                    </Badge>
                  )}
                  <span className="text-[10px] text-[#9A93A8] font-mono self-center">#{r.id.slice(-6).toUpperCase()}</span>
                </>
              }
              amount={`${r.budget.toLocaleString("fr-FR")} ${r.currency === "XOF" ? "FCFA" : r.currency}`}
              meta={`${r.candidatures} candidature${r.candidatures > 1 ? "s" : ""}`}
              progress={r.progress}
              footer={
                <div className="space-y-2">
                  {/* Phase de chaque prestataire retenu, résumée (« 1 Contrat à signer · 1 En cours »). */}
                  {summary.length > 0 && (
                    <div className="flex flex-wrap gap-1.5" aria-label="Suivi des prestataires retenus">
                      {summary.map((x) => (
                        <Badge key={x.phase} tone={PHASE_TONE[x.phase]}>
                          {PHASE_LABEL[x.phase]} · {x.count}
                        </Badge>
                      ))}
                    </div>
                  )}
                  {r.action ? (
                    <Link
                      href={r.action.href}
                      className="flex items-center justify-between gap-2 rounded-xl bg-[#FFF6E3] px-3 py-2 text-[13px] font-bold text-[#B45309] hover:bg-[#FDECC8]"
                      style={{ textDecoration: "none" }}
                    >
                      <span className="flex items-center gap-1.5"><AlertCircle className="w-4 h-4" aria-hidden /> {r.action.label}</span>
                      <span aria-hidden>→</span>
                    </Link>
                  ) : (
                    <p className="flex items-center gap-1.5 rounded-xl bg-[#F6F5FA] px-3 py-2 text-[13px] text-[#6B6478]">
                      <CheckCircle2 className="w-4 h-4 text-[#047857]" aria-hidden /> Aucune action requise
                    </p>
                  )}
                </div>
              }
              secondary={r.isAnnonce ? { href: `/missions/${r.id}/proposals`, label: "Candidatures" } : null}
            />
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="p-5 rounded-2xl border border-[#E7E2F0] bg-white text-center text-[14px] text-[#6B6478]">
          {rows.length === 0 ? "Aucune mission publiée pour l'instant." : "Aucune mission dans ce filtre."}{" "}
          {(filter !== "Toutes" || search) && (
            <button type="button" className="font-bold underline text-[#191224]" onClick={() => { setFilter("Toutes"); setSearch(""); }}>
              Tout afficher
            </button>
          )}
        </p>
      )}
    </div>
  );
}
