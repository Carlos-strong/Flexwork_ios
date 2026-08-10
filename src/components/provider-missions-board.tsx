"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { MISSION_STATUSES, MISSION_STATUS_STYLE, type MissionStatusValue } from "@/lib/mission-status";
import { GARANT_ROLES } from "@/lib/role-dashboard";

type Mission = {
  id: string;
  titre: string;
  status: MissionStatusValue;
  budget: number;
  currency: string;
  domaine: string;
  riskLevel: string;
  requiredLevel: string | null;
  budgetType: string | null;
  tags: string[];
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

// Board de missions par rôle prestataire — même modèle visuel que /missions (grille de
// cartes, recherche, filtre par statut), enrichi des mécaniques réelles propres aux
// filières chantier (A9 : assurance effective bloquante sur risque élevé ; garants
// obligatoires pour Artisan/Manœuvre) plutôt que la table minimale dupliquée dans chaque
// dashboard/<role>/page.tsx.
export function ProviderMissionsBoard({
  role,
  title,
  subtitle,
}: {
  role: "artisan" | "manoeuvre" | "expert_digital" | "expert_btp_autres";
  title: string;
  subtitle: string;
}) {
  const { status } = useSession();
  const router = useRouter();

  const [missions, setMissions] = useState<Mission[] | null>(null);
  const [garantCount, setGarantCount] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<MissionStatusValue | "tous">("tous");
  const [applyingId, setApplyingId] = useState<string | null>(null);
  const [montant, setMontant] = useState("");
  const [message, setMessage] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const needsGarant = (GARANT_ROLES as readonly string[]).includes(role);

  useEffect(() => {
    if (status === "unauthenticated") router.push("/signin");
  }, [status, router]);

  useEffect(() => {
    if (status !== "authenticated") return;
    fetch("/api/missions").then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setMissions(d.items ?? []));
    if (needsGarant) {
      fetch("/api/profile/garants").then((r) => (r.ok ? r.json() : { items: [] })).then((d) => setGarantCount((d.items ?? []).length));
    }
  }, [status, needsGarant]);

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

  async function submitProposal(missionId: string) {
    setFeedback(null);
    const res = await fetch(`/api/missions/${missionId}/proposals`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ montant: Number(montant), message: message || undefined }),
    });
    if (res.ok) {
      setFeedback("Candidature envoyée.");
      setApplyingId(null);
      setMontant("");
      setMessage("");
    } else {
      const d = await res.json().catch(() => ({}));
      setFeedback(d.error === "kyc_not_verified" ? "Votre identité doit être vérifiée avant de candidater." : "Échec de la candidature.");
    }
  }

  if (status === "loading" || missions === null)
    return (
      <div className="min-h-screen bg-[#f8fafc] flex items-center justify-center">
        <div className="text-[14px] text-zinc-500">Chargement...</div>
      </div>
    );
  if (status === "unauthenticated") return null;

  return (
    <div className="min-h-screen bg-[#f8fafc]">
      <div className="mx-auto max-w-[1100px] px-4 py-6">
        <div className="mb-6">
          <h1 className="text-[22px] font-bold text-zinc-900">{title}</h1>
          <p className="text-[13px] text-zinc-500 mt-1">{subtitle}</p>
        </div>

        {needsGarant && garantCount === 0 && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-[#FEF9C3] border border-[#FCD116] text-[13px] text-zinc-700">
            <strong>Garant obligatoire manquant.</strong> Ajoutez au moins une personne ressource avant de candidater —{" "}
            <a href="/profile" className="text-[#008751] font-semibold hover:underline">compléter mon profil</a>.
          </div>
        )}

        {feedback && (
          <div className="mb-4 px-4 py-3 rounded-xl bg-[#f0faf5] border border-[#008751]/30 text-[13px] font-medium text-[#065f46]">
            {feedback}
          </div>
        )}

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
            <button onClick={() => setSearch("")} aria-label="Effacer" className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filtres */}
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
                    isActive ? "bg-[#008751] text-white border-[#008751] shadow-[0_4px_14px_rgba(0,135,81,0.25)]" : "bg-white text-gray-600 border-gray-100 hover:border-gray-200 hover:shadow-sm"
                  }`}
                >
                  {label}
                  <span className={`px-1.5 py-0.5 rounded-full text-[11px] font-semibold ${isActive ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"}`}>{countsByFilter[s] ?? 0}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Grille */}
        {filtered.length === 0 ? (
          <div className="bg-white rounded-2xl border border-zinc-200 p-10 text-center text-zinc-400 text-[13px]">
            {missions.length === 0 ? "Aucune mission ouverte dans votre domaine pour le moment." : "Aucune mission ne correspond à cette recherche."}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((m) => {
              const st = MISSION_STATUS_STYLE[m.status] ?? MISSION_STATUS_STYLE.brouillon;
              const isHighRisk = m.riskLevel === "high";
              return (
                <div key={m.id} className="h-full bg-white rounded-[20px] border border-gray-100 shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-5 flex flex-col gap-3">
                  <div className="flex items-start justify-between gap-3">
                    <h3 className="font-semibold text-[16px] leading-[1.25] line-clamp-2 pr-2 tracking-tight">{m.titre}</h3>
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold shrink-0 ${st.bg} ${st.text}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                      {st.label}
                    </span>
                  </div>

                  <div className="flex items-center gap-2 text-[13px] text-gray-500">
                    <span className="font-medium text-gray-800">{m.domaine}</span>
                    <span className="text-gray-300">•</span>
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold ${RISK_STYLE[m.riskLevel] ?? RISK_STYLE.low}`}>{m.riskLevel?.toUpperCase?.() ?? "—"}</span>
                    {m.requiredLevel && (
                      <>
                        <span className="text-gray-300">•</span>
                        <span className="text-[11px] font-medium text-gray-600">{m.requiredLevel}</span>
                      </>
                    )}
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

                  {isHighRisk && (
                    <div className="text-[11px] text-red-700 bg-red-50 border border-red-100 rounded-lg px-2.5 py-2">
                      Risque élevé — assurance effective requise avant de démarrer, sans dérogation (voir <a href="/declarations" className="underline font-medium">mes déclarations</a>).
                    </div>
                  )}

                  {/* mt-auto pousse ce bloc (prix + action) en bas de la carte, quelle que soit
                      la hauteur du contenu au-dessus (titre sur 1 ou 2 lignes, tags présents ou
                      non, encart risque élevé) — sans ça, les boutons "Candidater" n'étaient
                      alignés d'une carte à l'autre que par coïncidence. */}
                  <div className="mt-auto flex flex-col gap-3">
                    <div className="pt-1 border-t border-gray-50">
                      <div className="font-semibold text-[15px] tracking-tight">
                        {m.budgetType === "QUOTE" ? "Sur devis" : `${m.budget.toLocaleString("fr-FR")} ${m.currency}`}
                      </div>
                      {m.budgetType && (
                        <div className="text-[11px] text-gray-400 mt-0.5">{BUDGET_TYPE_LABEL[m.budgetType] ?? m.budgetType}</div>
                      )}
                    </div>

                    {applyingId === m.id ? (
                      <div className="flex flex-col gap-2">
                        <input type="number" placeholder="Votre montant" className="h-9 px-3 rounded-lg border border-zinc-200 text-[13px]" value={montant} onChange={(e) => setMontant(e.target.value)} />
                        <input type="text" placeholder="Message (optionnel)" className="h-9 px-3 rounded-lg border border-zinc-200 text-[13px]" value={message} onChange={(e) => setMessage(e.target.value)} />
                        <div className="flex gap-2">
                          <button onClick={() => submitProposal(m.id)} className="flex-1 h-9 rounded-full bg-[#008751] text-white text-[12px] font-semibold hover:bg-[#006e43] transition">Envoyer</button>
                          <button onClick={() => setApplyingId(null)} className="h-9 px-3 rounded-full border border-zinc-200 text-[12px] font-medium hover:bg-zinc-50 transition">Annuler</button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setApplyingId(m.id)}
                        disabled={needsGarant && garantCount === 0}
                        className="h-9 rounded-full bg-[#008751] text-white text-[12px] font-semibold hover:bg-[#006e43] disabled:opacity-40 disabled:cursor-not-allowed transition"
                      >
                        Candidater
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
