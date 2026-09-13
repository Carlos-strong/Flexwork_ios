"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Eye } from "lucide-react";
import { fetchDedupe } from "@/lib/fetch-dedupe";
import { Avatar } from "@/components/avatar";
import { weightedJalonsProgress } from "@/lib/jalons";

type ApiMission = {
  id: string;
  titre: string;
  status: string;
  budget: number;
  currency: string;
  domaine?: string;
  delaiJours?: number | null;
  dateExpiration?: string | null;
  observedProgress?: number;
  _count?: { proposals: number };
  contract?: {
    jalons: { status: string; montant: number; observedProgress: number }[];
    provider: { id: string; firstname: string | null; lastname: string | null; avatarPath: string | null } | null;
  } | null;
};

type Mission = {
  id: string;
  title: string;
  category: string;
  budget: string;
  status: string;
  freelanceName: string | null;
  freelanceId: string | null;
  freelanceAvatarPath: string | null;
  progress: number;
  deadline: string;
  proposals?: number;
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

const ACTIVE_STATUSES = ["proposition_acceptee", "contrat_genere", "contrat_signe", "fonds_sous_sequestre", "en_cours"];

// Même logique de délai que MissionsSection (prestataire) : J-X depuis dateExpiration,
// sinon delaiJours.
function deadlineOf(m: ApiMission): string {
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

function toDisplay(m: ApiMission): Mission {
  const proposals = m._count?.proposals ?? 0;
  let status: string;
  if (m.status === "publiee" && proposals > 0) status = "Propositions";
  else if (m.status === "publiee") status = "Ouverte";
  else if (m.status === "livrable_soumis" || hasPendingJalon(m)) status = "En révision";
  else if (ACTIVE_STATUSES.includes(m.status)) status = "En cours";
  else if (m.status === "validee" || m.status === "cloturee") status = "Livrée";
  else if (m.status === "mediation_ouverte") status = "Annulée";
  else status = "Ouverte";

  return {
    id: m.id,
    title: m.titre,
    category: m.domaine ?? "",
    budget: `${m.budget.toLocaleString("fr-FR")} ${m.currency}`,
    status,
    freelanceName: m.contract?.provider
      ? [m.contract.provider.firstname, m.contract.provider.lastname].filter(Boolean).join(" ") || "Prestataire"
      : null,
    freelanceId: m.contract?.provider?.id ?? null,
    freelanceAvatarPath: m.contract?.provider?.avatarPath ?? null,
    progress: progressOf(m),
    deadline: deadlineOf(m),
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
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchDedupe("/api/missions")
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
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-[28px] font-extrabold leading-none tracking-tight text-[#0A1931]">Mes Missions</h1>
            <span className="rounded-full bg-[#0A1931] text-white text-[10px] font-bold tracking-wide px-3 py-1.5">Cliente</span>
          </div>
          <p className="text-[13px] text-gray-500 mt-2">Gère toutes tes missions en un seul endroit — suis les propositions & les livrables.</p>
        </div>
        <Link
          href="/missions/new"
          className="bg-gradient-to-r from-[#FF6B35] to-[#FF3E6C] text-white rounded-full px-5 py-[10px] text-[13px] font-bold shadow-[0_4px_14px_rgba(255,107,53,0.3)] hover:shadow-[0_6px_20px_rgba(255,107,53,0.4)] hover:translate-y-[-1px] transition-all flex items-center justify-center gap-2 shrink-0"
          style={{ textDecoration: "none" }}
        >
          <span className="text-[16px] leading-none">+</span> Nouvelle mission
        </Link>
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

      {/* Filtres */}
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

      {/* Table missions (maquette Flexwork-Gestion-Missions-Dropdown) — remplace les cartes
          grille/liste (2026-09-04). Colonnes MISSION / FREELANCE / MONTANT / STATUT /
          PROGRESSION / ACTION. "Client" de la maquette omise (c'est toujours l'utilisateur
          connecté sur cette page — redondant). ACTION = uniquement "Voir" (renvoie vers la
          fiche détaillée /missions/[id]) — messagerie et dropdown "Validations partielles"
          retirés de cette colonne (2026-09-04), ce détail se consultant désormais sur la fiche
          mission elle-même plutôt que depuis la liste. */}
      <div className="bg-white rounded-[16px] border border-gray-100 shadow-sm overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-[#F9FAFB] border-b border-gray-100">
              <th className="text-left font-semibold text-[11px] tracking-widest text-gray-500 uppercase px-4 py-3">Mission</th>
              <th className="text-left font-semibold text-[11px] tracking-widest text-gray-500 uppercase px-4 py-3">Freelance</th>
              <th className="text-left font-semibold text-[11px] tracking-widest text-gray-500 uppercase px-4 py-3 whitespace-nowrap">Montant</th>
              <th className="text-left font-semibold text-[11px] tracking-widest text-gray-500 uppercase px-4 py-3">Statut</th>
              <th className="text-left font-semibold text-[11px] tracking-widest text-gray-500 uppercase px-4 py-3">Progression</th>
              <th className="text-left font-semibold text-[11px] tracking-widest text-gray-500 uppercase px-4 py-3">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {filtered.map((m) => {
              return (
                  <tr key={m.id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3 min-w-[220px]">
                        <div className="w-8 h-8 rounded-lg bg-gray-900 text-white flex items-center justify-center text-[10px] font-bold shrink-0">
                          {m.id.slice(-2).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <Link href={`/missions/${m.id}`} className="font-semibold text-[13px] text-[#0A1931] hover:text-[#FF6B35] transition-colors line-clamp-1" style={{ textDecoration: "none" }}>
                            {m.title}
                          </Link>
                          <div className="text-[10px] text-gray-400 font-mono">#{m.id.slice(-6).toUpperCase()}{m.deadline ? ` · ⏰ ${m.deadline}` : ""}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {m.freelanceName ? (
                        <div className="flex items-center gap-2">
                          <Avatar
                            src={m.freelanceAvatarPath ? `/api/users/${m.freelanceId}/avatar` : null}
                            initials={m.freelanceName.charAt(0)}
                            gradient="from-[#FF6B35] to-[#F7C948]"
                            size={28}
                          />
                          <span className="text-[12px] font-medium text-[#0A1931] truncate">{m.freelanceName}</span>
                        </div>
                      ) : (
                        <span className="text-gray-400 text-[12px]">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-bold text-[#0A1931] whitespace-nowrap">{m.budget}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex rounded-full px-3 py-1 text-[11px] font-bold border whitespace-nowrap ${STATUS_STYLE[m.status] || "bg-gray-100"}`}>
                        {m.status === "Propositions" && m.proposals ? `${m.proposals} ${m.status}` : m.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-20 h-1.5 rounded-full bg-gray-100 overflow-hidden shrink-0">
                          <div className="h-full bg-gradient-to-r from-[#FF6B35] to-[#F7C948] rounded-full transition-all" style={{ width: `${m.progress}%` }} />
                        </div>
                        <span className="text-[11px] font-semibold text-gray-600 whitespace-nowrap">{m.progress}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {/* "Voir" — renvoie vers la fiche détaillée de la mission
                            (/missions/[id] : bandeau 6-phases + vue de validation pour une
                            mission engagée, ou détail générique sinon). Seule action de cette
                            colonne (2026-09-04) — messagerie et "Validations partielles" se
                            consultent désormais depuis la fiche mission elle-même. */}
                        <Link href={`/missions/${m.id}`} className="w-7 h-7 rounded-full bg-[#F8F6F3] hover:bg-gray-100 flex items-center justify-center shrink-0" style={{ textDecoration: "none" }} title="Voir">
                          <Eye className="w-3.5 h-3.5 text-zinc-500" />
                        </Link>
                      </div>
                    </td>
                  </tr>
              );
            })}
          </tbody>
        </table>
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
