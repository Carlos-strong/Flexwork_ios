"use client";

import { useEffect, useState } from "react";

type ApiMission = {
  id: string;
  titre: string;
  status: string;
  budget: number;
  currency: string;
  domaine?: string;
  _count?: { proposals: number };
};

type Mission = {
  id: string;
  title: string;
  category: string;
  budget: string;
  status: string;
  talent: string;
  flag: string;
  progress: number;
  deadline: string;
  proposals?: number;
};

const ACTIVE_STATUSES = ["proposition_acceptee", "contrat_genere", "contrat_signe", "fonds_sous_sequestre", "en_cours"];

function toDisplay(m: ApiMission): Mission {
  const proposals = m._count?.proposals ?? 0;
  let status: string;
  if (m.status === "publiee" && proposals > 0) status = "Propositions";
  else if (m.status === "publiee") status = "Ouverte";
  else if (ACTIVE_STATUSES.includes(m.status)) status = "En cours";
  else if (m.status === "livrable_soumis") status = "En révision";
  else if (m.status === "validee" || m.status === "cloturee") status = "Livrée";
  else if (m.status === "mediation_ouverte") status = "Annulée";
  else status = "Ouverte";

  return {
    id: m.id,
    title: m.titre,
    category: m.domaine ?? "",
    budget: `${m.budget.toLocaleString("fr-FR")} ${m.currency}`,
    status,
    talent: "",
    flag: "",
    progress: 0,
    deadline: "",
    proposals: status === "Propositions" ? proposals : undefined,
  };
}

const STATUS_STYLE: Record<string, string> = {
  "Ouverte": "bg-[#FFF1E6] text-[#C2410C] border-[#FFD6BA]",
  "En cours": "bg-[#DBEAFE] text-[#1E40AF] border-[#BFDBFE]",
  "En révision": "bg-[#FEF9C3] text-[#854D0E] border-[#FDE68A]",
  "Livrée": "bg-[#DCFCE7] text-[#166534] border-[#BBF7D0]",
  "Propositions": "bg-[#F3E8FF] text-[#6B21A8] border-[#E9D5FF]",
  "Annulée": "bg-[#F3F4F6] text-[#4B5563] border-[#E5E7EB]",
};

const FILTERS = ["Toutes", "Ouvertes", "En cours", "En révision", "Livrées", "Annulées"];

function matchesFilter(mission: Mission, filter: string): boolean {
  if (filter === "Toutes") return true;
  if (filter === "Ouvertes") return mission.status === "Ouverte";
  if (filter === "En cours") return mission.status === "En cours";
  if (filter === "En révision") return mission.status === "En révision";
  if (filter === "Livrées") return mission.status === "Livrée";
  if (filter === "Annulées") return mission.status === "Annulée";
  return true;
}

export default function MesMissions() {
  const [filter, setFilter] = useState("Toutes");
  const [search, setSearch] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/missions")
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d) => {
        if (cancelled) return;
        setMissions((d.items ?? []).map(toDisplay));
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => { cancelled = true; };
  }, []);

  const filtered = missions.filter((m) => {
    if (!(m.title.toLowerCase().includes(search.toLowerCase()) || m.category.toLowerCase().includes(search.toLowerCase()) || m.id.toLowerCase().includes(search.toLowerCase()))) return false;
    return matchesFilter(m, filter);
  });

  const counts: Record<string, number> = {
    "Toutes": missions.length,
    "Ouvertes": missions.filter((m) => m.status === "Ouverte").length,
    "En cours": missions.filter((m) => m.status === "En cours").length,
    "En révision": missions.filter((m) => m.status === "En révision").length,
    "Livrées": missions.filter((m) => m.status === "Livrée").length,
    "Annulées": missions.filter((m) => m.status === "Annulée").length,
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-8 h-8 border-[3px] border-[#FF7A00] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-[1400px] w-full mx-auto space-y-6">
      <style>{`
        .scrollbar-none::-webkit-scrollbar { display: none; }
        .scrollbar-none { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* Recherche mobile */}
      <div className="md:hidden flex items-center bg-white rounded-full px-4 py-2.5 border border-gray-100 shadow-sm text-[13px]">
        <span className="mr-2">🔍</span>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher mission..."
          className="bg-transparent outline-none w-full placeholder:text-gray-400"
        />
      </div>

      {/* Titre + action */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-extrabold leading-none tracking-tight">Mes Missions</h1>
          <p className="text-[13px] text-gray-500 mt-2">Gère toutes tes missions en un seul endroit — clients & talents afro.</p>
        </div>
        <button className="bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] text-white rounded-full px-5 py-[10px] text-[13px] font-bold shadow-[0_4px_14px_rgba(255,107,53,0.3)] hover:shadow-[0_6px_20px_rgba(255,107,53,0.4)] hover:translate-y-[-1px] transition-all flex items-center justify-center gap-2 shrink-0">
          <span className="text-[16px]">+</span> Nouvelle mission
        </button>
      </div>

      {/* Statistiques */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white rounded-[16px] p-4 border-l-4 border-gray-800 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
          <div className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">Total</div>
          <div className="text-[24px] font-extrabold mt-1">{counts["Toutes"]}</div>
          <div className="text-[11px] text-gray-400 mt-1">toutes missions</div>
        </div>
        <div className="bg-white rounded-[16px] p-4 border-l-4 border-[#FF6B35] shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
          <div className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">En cours</div>
          <div className="text-[24px] font-extrabold mt-1">{counts["En cours"]}</div>
          <div className="text-[11px] text-[#FF6B35] font-semibold mt-1">• actif maintenant</div>
        </div>
        <div className="bg-white rounded-[16px] p-4 border-l-4 border-[#F7C948] shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
          <div className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">En révision</div>
          <div className="text-[24px] font-extrabold mt-1">{counts["En révision"]}</div>
          <div className="text-[11px] text-gray-400 mt-1">en attente validation</div>
        </div>
        <div className="bg-white rounded-[16px] p-4 border-l-4 border-[#1B9C6A] shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
          <div className="text-[11px] font-bold tracking-widest text-gray-400 uppercase">Livrées</div>
          <div className="text-[24px] font-extrabold mt-1">{counts["Livrées"]}</div>
          <div className="text-[11px] text-[#1B9C6A] font-semibold mt-1">✓ terminées</div>
        </div>
      </div>

      {/* Filtres + bascule grille/liste */}
      <div className="flex flex-col sm:flex-row gap-3 justify-between">
        <div className="bg-white rounded-[16px] p-2 flex gap-2 overflow-x-auto scrollbar-none border border-gray-100 shadow-sm">
          {FILTERS.map((label) => {
            const active = filter === label;
            return (
              <button
                key={label}
                onClick={() => setFilter(label)}
                className={`whitespace-nowrap rounded-full px-4 py-[7px] text-[12px] font-bold transition ${active ? "bg-[#0A1931] text-white shadow" : "bg-[#F8F6F3] text-gray-600 hover:bg-gray-100"}`}
              >
                {label} <span className={`ml-1 ${active ? "text-white/70" : "text-gray-400"}`}>{counts[label] ?? 0}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 self-start sm:self-auto">
          <div className="bg-white rounded-full p-1 flex border border-gray-100 shadow-sm">
            <button
              onClick={() => setView("grid")}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] transition ${view === "grid" ? "bg-[#0A1931] text-white" : "text-gray-400 hover:text-gray-700"}`}
              title="Grille"
            >
              ⊞
            </button>
            <button
              onClick={() => setView("list")}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] transition ${view === "list" ? "bg-[#0A1931] text-white" : "text-gray-400 hover:text-gray-700"}`}
              title="Liste"
            >
              ☰
            </button>
          </div>
        </div>
      </div>

      {/* Cartes missions */}
      <div className={view === "grid" ? "grid md:grid-cols-2 lg:grid-cols-3 gap-4" : "flex flex-col gap-3"}>
        {filtered.map((m) => (
          <div
            key={m.id}
            className={`group bg-white rounded-[20px] p-5 border border-gray-100 hover:shadow-lg hover:border-orange-100 transition-all flex flex-col ${view === "list" ? "sm:flex-row sm:items-center gap-4" : ""}`}
          >
            <div className={view === "list" ? "flex-1 min-w-0" : "flex-1"}>
              <div className="flex justify-between items-start gap-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`rounded-full px-3 py-1 text-[11px] font-bold border ${STATUS_STYLE[m.status] || "bg-gray-100"}`}>
                    {m.status === "Propositions" && m.proposals ? `${m.proposals} ${m.status}` : m.status}
                  </span>
                  <span className="text-[10px] text-gray-400 font-mono">#{m.id.slice(-6).toUpperCase()}</span>
                </div>
                {m.deadline && <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">⏰ {m.deadline}</span>}
              </div>
              <h3 className="font-bold text-[14px] mt-3 leading-snug group-hover:text-[#FF6B35] transition-colors line-clamp-2">{m.title}</h3>
              <div className="text-[12px] text-gray-500 mt-1 flex items-center gap-2">
                <span>{m.category}</span>
                <span className="w-1 h-1 bg-gray-300 rounded-full" />
                <span className="font-bold text-[#0A1931]">{m.budget}</span>
              </div>
              {m.talent && (
                <div className="flex items-center gap-2 mt-4">
                  <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#FF6B35] to-[#F7C948] flex items-center justify-center text-[11px] font-bold text-white">{m.talent.charAt(0)}</div>
                  <div className="text-[12px]">
                    <span className="font-semibold">{m.talent}</span> <span>{m.flag}</span>
                  </div>
                </div>
              )}
              {m.progress > 0 && (
                <div className="mt-4">
                  <div className="flex justify-between text-[10px] font-bold text-gray-400 mb-1">
                    <span>Progression</span>
                    <span className="text-[#0A1931]">{m.progress}%</span>
                  </div>
                  <div className="h-[6px] bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-[#FF6B35] to-[#F7C948] rounded-full transition-all" style={{ width: `${m.progress}%` }} />
                  </div>
                </div>
              )}
            </div>
            <div className={`flex gap-2 ${view === "list" ? "sm:w-[140px] shrink-0 mt-2 sm:mt-0" : "mt-auto pt-4"}`}>
              <button className="flex-1 bg-[#0A1931] hover:bg-black text-white rounded-full py-2 text-[12px] font-bold transition">Voir</button>
              <button className="bg-[#F8F6F3] hover:bg-gray-100 rounded-full px-3 py-2 text-[12px]">💬</button>
            </div>
          </div>
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="bg-white rounded-[20px] p-12 text-center border border-dashed border-gray-200">
          <div className="text-[24px] mb-2">🔍</div>
          <div className="font-bold text-[14px]">Aucune mission trouvée</div>
          <div className="text-[12px] text-gray-500 mt-1">Essaie un autre filtre ou mot-clé.</div>
        </div>
      )}
    </div>
  );
}
