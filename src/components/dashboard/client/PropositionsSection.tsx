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
import { PROPOSAL_BADGE_STYLE, proposalBadge, proposalBaseStatus, type ProposalBadge } from "@/lib/proposal-tracking";
import { timeAgo } from "@/lib/time-ago";
import { countryFlag } from "@/lib/country-flag";
import { formatProposalAmount } from "@/lib/budget-format";
import { personFullName } from "@/lib/person-name";
import { ApplicationsTrackingCard } from "@/components/dashboard/ApplicationsTrackingCard";

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
type CardStatus = ProposalBadge;

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

// Badge, statut de base et couleurs : règle commune à toutes les vues d'une candidature
// (src/lib/proposal-tracking.ts).


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
          ? personFullName(p.provider) || "Prestataire"
          : "Prestataire";
        return {
          id: p.id,
          titre: p.mission.titre,
          category: p.mission.domaine ?? "Mission",
          budget: formatProposalAmount(p),
          baseStatus: proposalBaseStatus(p, "client"),
          status: proposalBadge(p, "client"),
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
    { label: "À traiter", value: stats.enNegociation, sub: "nouvelles ou en négociation", color: "border-[#6D28D9]", text: "text-[#6D28D9]" },
    { label: "Acceptées", value: stats.acceptees, sub: "→ contrat sécurisé", color: "border-[#4C1D95]", text: "text-[#4C1D95]" },
    { label: "Refusées", value: stats.refusees, sub: "ou annulées", color: "border-[#EF4444]", text: "text-[#EF4444]" },
  ];

  return (
    <div className="page-width space-y-6">
      {/* Titre */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold leading-none tracking-tight text-[#191224]">Propositions reçues</h1>
          <p className="text-[13px] text-gray-500 mt-2">Suis les offres reçues sur tes missions et fais avancer la négociation.</p>
        </div>
        <Link
          href="/missions/new"
          className="bg-gradient-to-r from-[#6D28D9] to-[#FF3E6C] text-white rounded-full px-5 py-[10px] text-[13px] font-bold shadow-[0_4px_14px_rgba(109,40,217,0.3)] hover:shadow-[0_6px_20px_rgba(109,40,217,0.4)] hover:translate-y-[-1px] transition-all flex items-center justify-center gap-2 shrink-0"
          style={{ textDecoration: "none" }}
        >
          + Publier une mission
        </Link>
      </div>

      {/* État et suivi des candidatures reçues — déplacé ici depuis le tableau de bord client
          (2026-11-11). « Voir tout » descend vers la liste complète ci-dessous. */}
      <ApplicationsTrackingCard viewer="client" seeAllHref="#propositions-liste" />

      {/* Recherche */}
      <div id="propositions-liste" className="scroll-mt-20 flex items-center bg-[#F6F5FA] rounded-full px-4 py-2.5 w-full text-[13px] border border-transparent focus-within:border-violet-200 focus-within:bg-white transition">
        <Search className="w-4 h-4 text-gray-400 mr-2" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher mission, domaine, prestataire..."
          className="bg-transparent outline-none w-full placeholder:text-gray-400 text-[#191224]"
        />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {statCards.map((s) => (
          <div key={s.label} className={`bg-white rounded-[16px] p-4 border-l-4 ${s.color} shadow-[0_1px_3px_rgba(0,0,0,0.05)]`}>
            <div className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">{s.label}</div>
            <div className="text-[24px] font-extrabold mt-1 text-[#191224]">{s.value}</div>
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
                className={`whitespace-nowrap rounded-full px-4 py-[7px] text-[12px] font-bold transition ${active ? "bg-[#191224] text-white shadow" : "bg-[#F6F5FA] text-gray-600 hover:bg-gray-100"}`}
              >
                {f.id} <span className={`ml-1 ${active ? "text-white/70" : "text-gray-400"}`}>{f.count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="bg-white rounded-full p-1 flex border border-gray-100 shadow-sm">
            <button onClick={() => setView("grid")} title="Grille" className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] transition ${view === "grid" ? "bg-[#191224] text-white" : "text-gray-400 hover:text-gray-700"}`}>⊞</button>
            <button onClick={() => setView("list")} title="Liste" className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] transition ${view === "list" ? "bg-[#191224] text-white" : "text-gray-400 hover:text-gray-700"}`}>☰</button>
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
          <Link href="/missions/new" className="mt-4 inline-flex h-9 px-5 rounded-full bg-[#6D28D9] text-white text-[12px] font-semibold items-center" style={{ textDecoration: "none" }}>
            + Publier une mission
          </Link>
        </div>
      ) : (
        <>
          <div className={view === "grid" ? "grid md:grid-cols-2 lg:grid-cols-3 gap-4" : "flex flex-col gap-3"}>
            {filtered.map((c) => (
              <div
                key={c.id}
                className={`group bg-white rounded-[20px] p-5 border border-gray-100 hover:shadow-lg hover:border-violet-100 transition-all ${view === "list" ? "flex flex-col sm:flex-row sm:items-center gap-4" : ""}`}
              >
                <div className={view === "list" ? "flex-1 min-w-0" : ""}>
                  <div className="flex justify-between items-start gap-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`rounded-full px-3 py-1 text-[11px] font-bold border ${PROPOSAL_BADGE_STYLE[c.status]}`}>{c.status}</span>
                      <span className="text-[10px] text-gray-400 font-mono">#{c.id.slice(-6).toUpperCase()}</span>
                      {c.round > 1 && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-bold bg-[#EFEAF8] text-[#6B6478] border border-[#E7E2F0]">Round {c.round}</span>
                      )}
                    </div>
                    <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">{c.time}</span>
                  </div>
                  <h3 className="font-bold text-[14px] mt-3 leading-snug group-hover:text-[#6D28D9] transition-colors line-clamp-2">{c.titre}</h3>
                  <div className="text-[12px] text-gray-500 mt-1 flex items-center gap-2">
                    <span>{c.category}</span>
                    <span className="w-1 h-1 bg-gray-300 rounded-full" />
                    <span className="font-bold text-[#191224]">{c.budget}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-4">
                    <Avatar
                      src={c.providerAvatarPath ? `/api/users/${c.providerId}/avatar` : null}
                      initials={c.provider.charAt(0)}
                      size={28}
                      gradient="from-[#8B5CF6] to-[#6D28D9]"
                    />
                    <div className="text-[12px]">
                      <span className="font-semibold text-[#191224]">{c.provider}</span> <span>{c.flag}</span>
                    </div>
                  </div>
                </div>
                <div className={`flex gap-2 ${view === "list" ? "sm:w-[150px] shrink-0 mt-2 sm:mt-0" : "mt-4"}`}>
                  <Link href={c.href} className="flex-1 bg-[#191224] hover:bg-black text-white rounded-full py-2 text-[12px] font-bold transition text-center" style={{ textDecoration: "none" }}>
                    Voir
                  </Link>
                  {/* Messagerie client unifiée (deep-link ?missionId=). */}
                  <Link href={`/client/messages?missionId=${c.missionId}`} className="bg-[#F6F5FA] hover:bg-gray-100 rounded-full px-3 py-2 flex items-center justify-center" style={{ textDecoration: "none" }}>
                    <MessageCircle className="w-4 h-4 text-zinc-500" />
                  </Link>
                </div>
              </div>
            ))}
          </div>

          {filtered.length === 0 && (
            <div className="bg-white rounded-[20px] p-12 text-center border border-dashed border-gray-200">
              <div className="text-[24px] mb-2">🔍</div>
              <div className="font-bold text-[14px] text-[#191224]">Aucune proposition trouvée</div>
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
