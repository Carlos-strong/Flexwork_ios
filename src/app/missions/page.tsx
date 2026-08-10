"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Search, X, ArrowRight } from "lucide-react";
import { MISSION_STATUSES, MISSION_STATUS_STYLE, type MissionStatusValue } from "@/lib/mission-status";
import { ROLE_MISSIONS } from "@/lib/role-dashboard";

type Mission = {
  id: string;
  titre: string;
  status: MissionStatusValue;
  budget: number;
  currency: string;
  domaine: string;
  riskLevel: string;
  createdAt: string;
  professionalType: string | null;
  requiredLevel: string | null;
  budgetType: string | null;
  tags: string[];
};

const PROFESSIONAL_TYPE_LABEL: Record<string, string> = {
  EXPERT_DIGITAL: "Expert Digital",
  EXPERT_BTP: "Expert BTP / Autres",
  ARTISAN: "Artisan",
  MANOEUVRE: "Manœuvre",
};

const BUDGET_TYPE_LABEL: Record<string, string> = {
  FIXED: "Prix fixe",
  RATE: "Taux horaire/journalier",
  QUOTE: "Devis libre",
};

const RISK_STYLE: Record<string, string> = {
  high: "bg-red-100 text-red-700",
  medium: "bg-amber-100 text-amber-800",
  low: "bg-emerald-100 text-emerald-800",
};

// Reprend le modèle visuel de Mission/ (grille de cartes, recherche, chips de filtre par
// statut) — sans les éléments qui n'ont pas d'équivalent réel dans ce projet :
// - Wallet et onglet Profil : le modèle v3 ne détient jamais les fonds (pas de solde
//   interne), et /profile existe déjà séparément.
// - Jalons/paiements fractionnés : le cycle réel est HOLD → travaux → RELEASE (voir
//   src/app/api/missions/[id]/escrow), pas de découpage en étapes.
// - Sélecteur de rôle manuel et badges "vérifié" décoratifs : le rôle vient de la session
//   authentifiée, jamais d'un bouton ; le seul badge réel est l'identité KYC (US-204), pas
//   affiché ici par défaut faute de donnée dans /api/missions.
//
// Point d'entrée générique — reste la vue "mes missions" du client. Les autres profils
// (Artisan, Manœuvre, Expert Digital, Expert BTP/Autres) ont chacun leur propre page
// enrichie de leurs mécaniques réelles (garants, assurance effective) — voir
// src/components/provider-missions-board.tsx — vers laquelle on redirige ici, même
// principe que /dashboard → dashboard/<role>.
export default function MissionsListPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const role = (session?.user as { role?: string } | undefined)?.role;
  const isClient = role === "client";

  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<MissionStatusValue | "tous">("tous");

  useEffect(() => {
    if (status === "authenticated" && role && ROLE_MISSIONS[role]) {
      router.replace(ROLE_MISSIONS[role]);
    }
  }, [status, role, router]);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/signin");
  }, [status, router]);

  useEffect(() => {
    if (status === "authenticated") {
      fetch("/api/missions")
        .then((r) => (r.ok ? r.json() : { items: [] }))
        .then((d) => setMissions(d.items ?? d))
        .finally(() => setLoading(false));
    }
  }, [status]);

  const countsByFilter = useMemo(() => {
    const counts: Record<string, number> = { tous: missions?.length ?? 0 };
    for (const s of MISSION_STATUSES) counts[s] = missions?.filter((m) => m.status === s).length ?? 0;
    return counts;
  }, [missions]);

  const filtered = useMemo(() => {
    const query = search.toLowerCase().trim();
    return (missions ?? []).filter((m) => {
      const matchesQuery = !query || m.titre.toLowerCase().includes(query) || m.domaine.toLowerCase().includes(query);
      const matchesStatus = statusFilter === "tous" || m.status === statusFilter;
      return matchesQuery && matchesStatus;
    });
  }, [missions, search, statusFilter]);

  if (status === "loading" || loading)
    return (
      <div className="min-h-screen bg-zinc-50 flex items-center justify-center">
        <div className="text-[14px] text-zinc-500">Chargement...</div>
      </div>
    );

  if (status === "unauthenticated") return null;

  const activeCount = missions?.filter((m) => !["publiee", "cloturee"].includes(m.status)).length ?? 0;
  const openCount = missions?.filter((m) => m.status === "publiee").length ?? 0;
  const closedCount = missions?.filter((m) => m.status === "cloturee").length ?? 0;

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <div className="mx-auto max-w-[1100px] px-4 py-6">
        {/* En-tête */}
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <div>
            <h1 className="text-[22px] font-bold text-zinc-900">{isClient ? "Mes missions" : "Missions disponibles"}</h1>
            <p className="text-[13px] text-zinc-500 mt-1">
              {isClient ? "Gérez et suivez toutes vos missions" : "Trouvez la mission qui correspond à votre profil"}
            </p>
          </div>
          {isClient && (
            <Link
              href="/missions/new"
              className="h-10 px-5 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] transition inline-flex items-center"
              style={{ textDecoration: "none" }}
            >
              + Nouvelle mission
            </Link>
          )}
        </div>

        {/* KPI */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-2xl border border-zinc-200 p-5 text-center">
            <div className="text-[28px] font-extrabold" style={{ color: "#008751" }}>{missions?.length ?? "…"}</div>
            <div className="text-[12px] text-zinc-500 mt-1">{isClient ? "Total publiées" : "Missions trouvées"}</div>
          </div>
          <div className="bg-white rounded-2xl border border-zinc-200 p-5 text-center">
            <div className="text-[28px] font-extrabold" style={{ color: "#FCD116" }}>{isClient ? activeCount : openCount}</div>
            <div className="text-[12px] text-zinc-500 mt-1">{isClient ? "En cours" : "Ouvertes"}</div>
          </div>
          <div className="bg-white rounded-2xl border border-zinc-200 p-5 text-center">
            <div className="text-[28px] font-extrabold" style={{ color: "#E8112D" }}>{isClient ? closedCount : "—"}</div>
            <div className="text-[12px] text-zinc-500 mt-1">{isClient ? "Terminées" : "Domaines"}</div>
          </div>
        </div>

        {/* Recherche */}
        <div className="relative mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher une mission..."
            className="w-full h-12 pl-11 pr-11 rounded-full bg-white border border-gray-100 shadow-[0_2px_12px_rgba(0,0,0,0.04)] text-[14px] placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[#008751] focus:border-transparent transition-all"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Effacer la recherche"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filtres par statut */}
        <div className="mb-6 -mx-4 px-4 overflow-x-auto scrollbar-none">
          <div className="flex gap-2.5 w-max pb-2">
            {(["tous", ...MISSION_STATUSES] as const).map((s) => {
              const isActive = statusFilter === s;
              const label = s === "tous" ? "Tous" : MISSION_STATUS_STYLE[s].label;
              return (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`h-9 px-4 rounded-full text-[13px] font-medium inline-flex items-center gap-2 border transition-all duration-200 whitespace-nowrap ${
                    isActive
                      ? "bg-[#008751] text-white border-[#008751] shadow-[0_4px_14px_rgba(0,135,81,0.25)]"
                      : "bg-white text-gray-600 border-gray-100 hover:border-gray-200 hover:shadow-sm"
                  }`}
                >
                  {label}
                  <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${isActive ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"}`}>
                    {countsByFilter[s] ?? 0}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Grille de cartes */}
        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-200 p-10 text-center text-zinc-400 text-[13px]">
            {missions?.length === 0
              ? isClient
                ? "Aucune mission publiée pour le moment."
                : "Aucune mission ouverte dans votre domaine."
              : "Aucune mission ne correspond à cette recherche."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((m) => {
              const st = MISSION_STATUS_STYLE[m.status] ?? MISSION_STATUS_STYLE.brouillon;
              return (
                <Link
                  key={m.id}
                  href={`/missions/${m.id}`}
                  className="group text-left relative bg-white rounded-[20px] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-5 flex flex-col gap-4 hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:-translate-y-[2px] transition-all duration-300"
                  style={{ textDecoration: "none", color: "inherit" }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-[16px] leading-[1.25] line-clamp-2 pr-2 tracking-tight">{m.titre}</h3>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${st.bg} ${st.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                      {st.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[13px] text-gray-500 flex-wrap">
                    <span className="font-medium text-gray-800">{m.domaine}</span>
                    <span className="text-gray-300">•</span>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${RISK_STYLE[m.riskLevel] ?? RISK_STYLE.low}`}>
                      {m.riskLevel?.toUpperCase?.() ?? "—"}
                    </span>
                    {m.professionalType && (
                      <span className="text-[11px] text-gray-500">{PROFESSIONAL_TYPE_LABEL[m.professionalType] ?? m.professionalType}</span>
                    )}
                    {m.requiredLevel && <span className="text-[11px] text-gray-400">· {m.requiredLevel}</span>}
                  </div>

                  {m.tags && m.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {m.tags.map((tag) => (
                        <span key={tag} className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-zinc-100 text-zinc-600">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1 border-t border-gray-50 mt-1">
                    <div>
                      <div className="font-semibold text-[15px] tracking-tight">
                        {m.budgetType === "QUOTE" ? "Sur devis" : `${m.budget.toLocaleString("fr-FR")} ${m.currency}`}
                      </div>
                      <div className="text-[11px] text-zinc-400 mt-0.5">{new Date(m.createdAt).toLocaleDateString("fr-FR")}</div>
                    </div>
                    <span className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center group-hover:translate-x-0.5 transition-transform shrink-0">
                      <ArrowRight className="w-4 h-4" />
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
