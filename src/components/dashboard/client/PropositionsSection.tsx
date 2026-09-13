"use client";

// ---------------------------------------------------------------------------
// Section « Propositions » du dashboard CLIENT (/client/propositions) — applique le modèle
// d'affichage de la section prestataire CandidaturesSection.tsx (mes candidatures) : même
// architecture de vue (recherche, tuiles de stats, filtres + bascule grille/liste, cartes),
// transposée aux propositions REÇUES par le client sur ses missions. Alimentée par
// /api/dashboard/client-proposals (miroir client de /api/dashboard/my-proposals).
//
// Écart UI assumé (règle R03) : duplique volontairement la structure de CandidaturesSection
// — les deux vues restent proches mais les sémantiques/actions diffèrent (côté client :
// « Reçue » au lieu d'« Envoyée », action « Voir » → /missions/[id]/proposals, message →
// messagerie client). Une factorisation en composant générique serait possible si une 3ᵉ vue
// de ce type apparaissait.
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useState } from "react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import Link from "next/link";
import { FileText, Search, MessageCircle } from "lucide-react";
import { Avatar } from "@/components/avatar";
import { isRevisionPending, REVISION_REQUESTED_LABEL } from "@/lib/proposal-status";

type Proposal = {
  id: string;
  montant: number;
  status: string;
  createdAt: string;
  // Champs de négociation/révision (2026-09-09) — exposés par /api/dashboard/client-proposals
  // (MissionProposal complet) : roundActuel (≥ 1 = déjà révisé) et revisionRequestedAt
  // (non nul = le client attend la nouvelle version du devis/de la proposition).
  roundActuel?: number;
  revisionRequestedAt?: string | null;
  provider?: {
    id: string;
    firstname: string | null;
    lastname: string | null;
    country: string | null;
    avatarPath: string | null;
  } | null;
  mission: {
    id: string;
    titre: string;
    domaine?: string | null;
    budget: number;
    currency: string;
    budgetType: string | null;
    status: string;
  };
};

// Badge affiché sur la carte : pour une proposition RETENUE, il suit l'avancement RÉEL de la
// mission (MissionStatus) au lieu de rester figé sur « Acceptée » — même synchronisation que
// CandidaturesSection.
type CardStatus =
  | "Reçue"
  | "En négociation"
  | "Révision demandée"
  | "Acceptée"
  | "Refusée"
  | "Contrat généré"
  | "Contrat signé"
  | "Fonds séquestrés"
  | "Travail en cours"
  | "Livrable soumis"
  | "Paiement libéré"
  | "Médiation en cours"
  | "Terminée";

type Card = {
  id: string;
  titre: string;
  category: string;
  budget: string;
  baseStatus: CardStatus;
  status: CardStatus;
  // Round de négociation en cours (0 = première soumission) — affiché sur la carte.
  round: number;
  provider: string;
  providerId: string | null;
  providerAvatarPath: string | null;
  flag: string;
  time: string;
  href: string;
  missionId: string;
};

type Stats = { total: number; enNegociation: number; acceptees: number; refusees: number };

// Regroupement des statuts réels en 4 statuts d'affichage — vue CLIENT d'une proposition
// reçue : "envoyee" = reçue (en attente d'une action du client), la négociation en cours
// regroupe les 3 étapes, refusée/annulée = refusée. identique à CandidaturesSection sauf
// « Envoyée » → « Reçue » (point de vue inversé).
const DISPLAY_STATUS: Record<string, CardStatus> = {
  envoyee: "Reçue",
  preselectionnee: "En négociation",
  en_negociation: "En négociation",
  devis_valide: "En négociation",
  acceptee: "Acceptée",
  refusee: "Refusée",
  annulee_definitive: "Refusée",
};

const STATUS_STYLE: Record<CardStatus, string> = {
  "Reçue": "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]",
  "En négociation": "bg-[#FEF9C3] text-[#854D0E] border-[#FDE68A]",
  [REVISION_REQUESTED_LABEL]: "bg-[#EDE9FE] text-[#6D28D9] border-[#DDD6FE]",
  "Acceptée": "bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]",
  "Refusée": "bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]",
  "Contrat généré": "bg-[#FEF3C7] text-[#92400E] border-[#FCD34D]",
  "Contrat signé": "bg-[#FEF3C7] text-[#92400E] border-[#FCD34D]",
  "Fonds séquestrés": "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]",
  "Travail en cours": "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]",
  "Livrable soumis": "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]",
  "Paiement libéré": "bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]",
  "Médiation en cours": "bg-[#FEE2E2] text-[#B91C1C] border-[#FECACA]",
  "Terminée": "bg-[#0A1931] text-white border-[#0A1931]",
};

const MISSION_STAGE_CARD: Record<string, CardStatus> = {
  proposition_acceptee: "Acceptée",
  contrat_genere: "Contrat généré",
  contrat_signe: "Contrat signé",
  fonds_sous_sequestre: "Fonds séquestrés",
  en_cours: "Travail en cours",
  livrable_soumis: "Livrable soumis",
  validee: "Paiement libéré",
  mediation_ouverte: "Médiation en cours",
  cloturee: "Terminée",
};

function badgeStatusFor(p: Proposal): CardStatus {
  // Révision demandée au candidat (POST .../devis/request-revision) : tant qu'il n'a pas
  // resoumis, la carte l'annonce au lieu du statut brut. Règle partagée
  // (src/lib/proposal-status.ts) : le statut terminal prime — une candidature écartée au
  // profit d'une autre n'affiche plus « Révision demandée ». (2026-09-09)
  if (isRevisionPending(p)) return REVISION_REQUESTED_LABEL;
  if (p.status === "acceptee" || p.status === "devis_valide") {
    return MISSION_STAGE_CARD[p.mission.status] ?? "Acceptée";
  }
  return DISPLAY_STATUS[p.status] ?? "Reçue";
}

function countryFlag(code?: string | null): string {
  if (!code || code.length !== 2) return "🌍";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function fmtBudget(p: Proposal): string {
  if (p.montant > 0) return `${p.montant.toLocaleString("fr-FR")} ${p.mission.currency}`;
  return p.mission.budgetType === "QUOTE" ? "Sur devis" : `${p.mission.budget.toLocaleString("fr-FR")} ${p.mission.currency}`;
}

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

export default function PropositionsSection() {
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [search, setSearch] = useState("");
  const [activeFilter, setActiveFilter] = useState("Toutes");
  const [view, setView] = useState<"grid" | "list">("grid");

  useEffect(() => {
    fetchDedupe("/api/dashboard/client-proposals")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => setProposals(d.items ?? []))
      .catch(() => setProposals([]));
  }, []);

  const cards: Card[] = useMemo(
    () =>
      (proposals ?? []).map((p) => {
        const providerName = p.provider
          ? [p.provider.firstname, p.provider.lastname].filter(Boolean).join(" ") || "Prestataire"
          : "Prestataire";
        return {
          id: p.id,
          titre: p.mission.titre,
          category: p.mission.domaine ?? "Mission",
          budget: fmtBudget(p),
          baseStatus: DISPLAY_STATUS[p.status] ?? "Reçue",
          status: badgeStatusFor(p),
          round: p.roundActuel ?? 0,
          provider: providerName,
          providerId: p.provider?.id ?? null,
          providerAvatarPath: p.provider?.avatarPath ?? null,
          flag: countryFlag(p.provider?.country),
          time: timeAgo(p.createdAt),
          href: `/missions/${p.mission.id}/proposals`,
          missionId: p.mission.id,
        };
      }),
    [proposals]
  );

  const stats: Stats = useMemo(
    () => ({
      total: cards.length,
      enNegociation: cards.filter((c) => c.baseStatus === "En négociation" || c.baseStatus === "Reçue").length,
      acceptees: cards.filter((c) => c.baseStatus === "Acceptée").length,
      refusees: cards.filter((c) => c.baseStatus === "Refusée").length,
    }),
    [cards]
  );

  const FILTERS = [
    { id: "Toutes", count: cards.length },
    { id: "Reçue", count: cards.filter((c) => c.baseStatus === "Reçue").length },
    { id: "En négociation", count: cards.filter((c) => c.baseStatus === "En négociation").length },
    { id: "Acceptée", count: stats.acceptees },
    { id: "Refusée", count: stats.refusees },
  ];

  const filtered = cards.filter((c) => {
    const q = search.toLowerCase();
    const okSearch = c.titre.toLowerCase().includes(q) || c.category.toLowerCase().includes(q) || c.provider.toLowerCase().includes(q);
    const okFilter = activeFilter === "Toutes" || c.baseStatus === activeFilter;
    return okSearch && okFilter;
  });

  const statCards = [
    { label: "Total", value: stats.total, sub: "propositions reçues", color: "border-gray-800", text: "" },
    { label: "À traiter", value: stats.enNegociation, sub: "nouvelles ou en négociation", color: "border-[#FF6B35]", text: "text-[#FF6B35]" },
    { label: "Acceptées", value: stats.acceptees, sub: "→ contrat sécurisé", color: "border-[#1B9C6A]", text: "text-[#1B9C6A]" },
    { label: "Refusées", value: stats.refusees, sub: "ou annulées", color: "border-[#EF4444]", text: "text-[#EF4444]" },
  ];

  return (
    <div className="max-w-[1400px] w-full mx-auto space-y-6">
      {/* Titre */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold leading-none tracking-tight text-[#0A1931]">Propositions reçues</h1>
          <p className="text-[13px] text-gray-500 mt-2">Suis les offres reçues sur tes missions et fais avancer la négociation.</p>
        </div>
        <Link
          href="/missions/new"
          className="bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] text-white rounded-full px-5 py-[10px] text-[13px] font-bold shadow-[0_4px_14px_rgba(255,107,53,0.3)] hover:shadow-[0_6px_20px_rgba(255,107,53,0.4)] hover:translate-y-[-1px] transition-all flex items-center justify-center gap-2 shrink-0"
          style={{ textDecoration: "none" }}
        >
          + Publier une mission
        </Link>
      </div>

      {/* Recherche */}
      <div className="flex items-center bg-[#F9F5F0] rounded-full px-4 py-2.5 w-full text-[13px] border border-transparent focus-within:border-orange-200 focus-within:bg-white transition">
        <Search className="w-4 h-4 text-gray-400 mr-2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher mission, domaine, prestataire..."
          className="bg-transparent outline-none w-full placeholder:text-gray-400 text-[#0A1931]"
        />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className={`bg-white rounded-[16px] p-4 border-l-4 ${s.color} shadow-[0_1px_3px_rgba(0,0,0,0.05)]`}>
            <div className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">{s.label}</div>
            <div className="text-[24px] font-extrabold mt-1 text-[#0A1931]">{s.value}</div>
            <div className={`text-[11px] mt-1 ${s.text || "text-gray-400"}`}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filtres + vue */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between">
        <div className="bg-white rounded-[16px] p-2 flex gap-2 overflow-x-auto border border-gray-100 shadow-sm">
          {FILTERS.map((f) => {
            const active = activeFilter === f.id;
            return (
              <button
                key={f.id}
                onClick={() => setActiveFilter(f.id)}
                className={`whitespace-nowrap rounded-full px-4 py-[7px] text-[12px] font-bold transition ${active ? "bg-[#0A1931] text-white shadow" : "bg-[#F8F6F3] text-gray-600 hover:bg-gray-100"}`}
              >
                {f.id} <span className={`ml-1 ${active ? "text-white/70" : "text-gray-400"}`}>{f.count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="bg-white rounded-full p-1 flex border border-gray-100 shadow-sm">
            <button onClick={() => setView("grid")} title="Grille" className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] transition ${view === "grid" ? "bg-[#0A1931] text-white" : "text-gray-400 hover:text-gray-700"}`}>⊞</button>
            <button onClick={() => setView("list")} title="Liste" className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] transition ${view === "list" ? "bg-[#0A1931] text-white" : "text-gray-400 hover:text-gray-700"}`}>☰</button>
          </div>
        </div>
      </div>

      {/* Cartes */}
      {proposals === null ? (
        <div className="bg-white rounded-[20px] p-10 text-center text-[13px] text-gray-400">Chargement…</div>
      ) : cards.length === 0 ? (
        <div className="bg-white rounded-[20px] border border-gray-100 p-12 text-center">
          <div className="text-4xl mb-3">📨</div>
          <p className="text-[14px] text-zinc-500 font-medium">Aucune proposition reçue pour l&apos;instant.</p>
          <Link href="/missions/new" className="mt-4 inline-flex h-9 px-5 rounded-full bg-[#FF7A00] text-white text-[12px] font-semibold items-center" style={{ textDecoration: "none" }}>
            + Publier une mission
          </Link>
        </div>
      ) : (
        <>
          <div className={view === "grid" ? "grid md:grid-cols-2 lg:grid-cols-3 gap-4" : "flex flex-col gap-3"}>
            {filtered.map((c) => (
              <div
                key={c.id}
                className={`group bg-white rounded-[20px] p-5 border border-gray-100 hover:shadow-lg hover:border-orange-100 transition-all ${view === "list" ? "flex flex-col sm:flex-row sm:items-center gap-4" : ""}`}
              >
                <div className={view === "list" ? "flex-1 min-w-0" : ""}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`rounded-full px-3 py-1 text-[11px] font-bold border ${STATUS_STYLE[c.status]}`}>{c.status}</span>
                      <span className="text-[10px] text-gray-400 font-mono">#{c.id.slice(-6).toUpperCase()}</span>
                      {c.round > 1 && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-[#F1F5F9] text-[#64748B] border border-[#E2E8F0]">Round {c.round}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">{c.time}</span>
                  </div>
                  <h3 className="font-bold text-[14px] mt-3 leading-snug group-hover:text-[#FF6B35] transition-colors line-clamp-2">{c.titre}</h3>
                  <div className="text-[12px] text-gray-500 mt-1 flex items-center gap-2">
                    <span>{c.category}</span>
                    <span className="w-1 h-1 bg-gray-300 rounded-full" />
                    <span className="font-bold text-[#0A1931]">{c.budget}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <Avatar
                      src={c.providerAvatarPath ? `/api/users/${c.providerId}/avatar` : null}
                      initials={c.provider.charAt(0)}
                      size={28}
                      gradient="from-[#8B5CF6] to-[#6D28D9]"
                    />
                    <div className="text-[12px]">
                      <span className="font-semibold text-[#0A1931]">{c.provider}</span> <span>{c.flag}</span>
                    </div>
                  </div>
                </div>
                <div className={`flex gap-2 ${view === "list" ? "sm:w-[150px] shrink-0 mt-2 sm:mt-0" : "mt-4"}`}>
                  <Link href={c.href} className="flex-1 bg-[#0A1931] hover:bg-black text-white rounded-full py-2 text-[12px] font-bold transition text-center" style={{ textDecoration: "none" }}>
                    Voir
                  </Link>
                  {/* Messagerie client unifiée (deep-link ?missionId=). */}
                  <Link href={`/client/messages?missionId=${c.missionId}`} className="bg-[#F8F6F3] hover:bg-gray-100 rounded-full px-3 py-2 flex items-center justify-center" style={{ textDecoration: "none" }}>
                    <MessageCircle className="w-4 h-4 text-zinc-500" />
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="bg-white rounded-[20px] p-12 text-center border border-dashed border-gray-200">
              <div className="text-[24px] mb-2">🔍</div>
              <div className="font-bold text-[14px] text-[#0A1931]">Aucune proposition trouvée</div>
              <div className="text-[12px] text-gray-500 mt-1">Essaie un autre filtre ou mot-clé.</div>
            </div>
          )}
        </>
      )}

      <div className="flex items-center gap-2 text-[12px] text-gray-400">
        <FileText className="w-4 h-4" /> Une proposition acceptée lance automatiquement le contrat sécurisé.
      </div>
    </div>
  );
}
