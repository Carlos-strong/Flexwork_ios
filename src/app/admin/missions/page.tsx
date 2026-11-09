"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { MISSION_STATUSES, type MissionStatusValue } from "@/lib/mission-status";
import { useAdminRole } from "@/components/admin/admin-role-context";
import {
  AdminCard,
  AdminEmpty,
  AdminPageHeader,
  KpiStrip,
  btnSecondary,
  fetchJson,
  formatXof,
  tableCell,
  tableHead,
} from "@/components/admin/admin-ui";

// Libellés COURTS, propres à la console : « Validée » plutôt que « Retenue de garantie en
// cours », qui parle au prestataire mais pas à l'administrateur. Le `Record` est exhaustif :
// tout statut ajouté au schéma casse la compilation ici tant qu'il n'a pas son libellé — une
// liste indépendante avait déjà oublié `remboursee` (corrigé le 2026-09-16).
const STATUS_LABEL: Record<MissionStatusValue, string> = {
  brouillon: "Brouillon",
  publiee: "Publiée",
  proposition_acceptee: "Proposition acceptée",
  contrat_genere: "Contrat généré",
  contrat_signe: "Contrat signé",
  fonds_sous_sequestre: "Fonds sous séquestre",
  en_cours: "En cours",
  livrable_soumis: "Livrable soumis",
  validee: "Validée",
  cloturee: "Clôturée",
  mediation_ouverte: "Médiation ouverte",
  remboursee: "Remboursée",
};

type KanbanMission = { id: string; titre: string; status: string; budget: number; client: { email: string }; mediationEnCours: boolean };
type CollusionSuspect = { clientId: string; providerId: string; transactionCount: number };

/**
 * Missions — rubrique de flexwork_job, en consultation pour tous les rôles qui la voient.
 *
 * La plateforme n'intervient pas dans le déroulé d'une mission (§6 : intermédiaire neutre) :
 * aucun geste n'est donc offert ici, ni au superviseur ni à la médiation. Le médiateur y lit
 * le contexte d'un litige ; l'anti-collusion reste réservée au superviseur, qui instruit les
 * recours, et n'apparaît pas pour les autres.
 */
export default function AdminMissionsPage() {
  const role = useAdminRole();
  const seesFraud = role === "superviseur";

  const [missions, setMissions] = useState<KanbanMission[] | null>(null);
  const [collusion, setCollusion] = useState<CollusionSuspect[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [k, c] = await Promise.all([
      fetchJson<{ items: KanbanMission[] }>("/api/admin/missions/kanban"),
      seesFraud ? fetchJson<{ items: CollusionSuspect[] }>("/api/admin/fraud/collusion") : Promise.resolve(null),
    ]);
    if (k.ok) setMissions(k.data.items);
    else setError("Les missions n’ont pas pu être chargées.");
    if (c && c.ok) setCollusion(c.data.items);
    setLoading(false);
  }, [seesFraud]);

  useEffect(() => {
    load();
  }, [load]);

  const list = missions ?? [];
  const byStatus = MISSION_STATUSES.map((status) => ({
    status,
    label: STATUS_LABEL[status],
    items: list.filter((m) => m.status === status),
  }));
  const active = list.filter((m) => !["brouillon", "cloturee", "remboursee"].includes(m.status)).length;
  const inDispute = list.filter((m) => m.mediationEnCours).length;
  const volume = list.reduce((sum, m) => sum + (m.budget > 0 ? m.budget : 0), 0);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon="📋"
        title="Missions"
        subtitle={`Les ${MISSION_STATUSES.length} statuts réels de Mission.status. La plateforme n’intervient pas dans le déroulé d’une mission : cet écran se lit, il ne s’actionne pas.`}
        readOnly
        actions={
          <button onClick={load} className={btnSecondary}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? "Actualisation…" : "Actualiser"}
          </button>
        }
      />

      {error && <div className="rounded-[12px] border border-[#F5C2BE] bg-[#FDEDEC] p-3 text-[13px] text-[#B42318]">{error}</div>}

      <KpiStrip
        items={[
          { icon: "📋", label: "Missions", value: missions ? list.length : "…", hint: "toutes, brouillons compris" },
          { icon: "⚡", label: "Actives", value: active, hint: "ni brouillon, ni close" },
          { icon: "⚖️", label: "En litige", value: inDispute, hint: "médiation en cours", tone: inDispute > 0 ? "amber" : "neutral" },
          { icon: "💶", label: "Budgets annoncés", value: formatXof(volume), hint: "montants déclarés par les clients", tone: "blue" },
        ]}
      />

      <AdminCard title="Kanban" subtitle="Une colonne par statut. Les montants sont les budgets annoncés, pas des fonds détenus." padded={false}>
        <div className="overflow-x-auto p-3">
          <div className="flex min-w-max gap-3">
            {byStatus.map((col) => (
              <div
                key={col.status}
                className={`w-[220px] shrink-0 rounded-[12px] border ${
                  col.status === "mediation_ouverte" ? "border-[#FCD89A] bg-[#FEF9E7]" : "border-[#E2E0D9] bg-[#FAFAF8]"
                }`}
              >
                <div className="flex items-center justify-between border-b border-[#E2E0D9] px-3 py-2.5">
                  <span className="truncate text-[11.5px] font-semibold text-[#1A1916]">{col.label}</span>
                  <span
                    className={`min-w-[20px] rounded-full px-1.5 py-0.5 text-center text-[10px] font-bold ${
                      col.items.length ? "bg-[#2D5BE3] text-white" : "bg-[#E2E0D9] text-[#5A5750]"
                    }`}
                  >
                    {col.items.length}
                  </span>
                </div>
                <div className="min-h-[80px] space-y-2 p-2">
                  {col.items.map((m) => (
                    <div key={m.id} className="rounded-[10px] border border-[#E2E0D9] bg-white p-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] font-semibold text-[#9C9A95]">#{m.id.slice(0, 8)}</span>
                        {m.mediationEnCours && (
                          <span className="rounded-full bg-[#FEF3C7] px-1.5 py-0.5 text-[9px] font-bold text-[#B45309]">⚖️ Litige</span>
                        )}
                      </div>
                      <div className="mt-1 line-clamp-2 text-[12px] font-semibold leading-tight">{m.titre}</div>
                      <div className="mt-1 truncate text-[11px] text-[#5A5750]">{m.client.email}</div>
                      <div className="mt-1 text-[11px] font-semibold text-[#1A1916]">{m.budget > 0 ? formatXof(m.budget) : "—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </AdminCard>

      {seesFraud && (
        <AdminCard
          id="antifraude"
          title="🛡️ Anti-collusion"
          subtitle="Paires client/prestataire aux opérations de séquestre répétées. Un signal à instruire, pas une preuve : aucun compte n’est touché d’ici."
          padded={false}
        >
          {collusion === null ? (
            <div className="p-5 text-[13px] text-[#9C9A95]">Chargement…</div>
          ) : collusion.length === 0 ? (
            <div className="p-5">
              <AdminEmpty>Aucune paire suspecte détectée.</AdminEmpty>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-[#E2E0D9] bg-[#FAFAF8]">
                  <tr>
                    <th className={tableHead}>Client</th>
                    <th className={tableHead}>Prestataire</th>
                    <th className={`${tableHead} text-right`}>Opérations</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E0D9]">
                  {collusion.map((c) => (
                    <tr key={`${c.clientId}-${c.providerId}`}>
                      <td className={`${tableCell} font-mono text-[11.5px]`}>{c.clientId}</td>
                      <td className={`${tableCell} font-mono text-[11.5px]`}>{c.providerId}</td>
                      <td className={`${tableCell} text-right font-semibold tabular-nums`}>{c.transactionCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </AdminCard>
      )}
    </div>
  );
}
