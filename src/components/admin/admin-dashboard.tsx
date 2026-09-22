"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw } from "lucide-react";
import { ADMIN_ROLE_META, modulesForRole } from "@/lib/admin-roles";
import { useAdminRole } from "@/components/admin/admin-role-context";
import { AdminCard, AdminNotice, AdminPageHeader, KpiStrip, btnSecondary, fetchJson, formatXof, type Kpi } from "@/components/admin/admin-ui";

type Dashboard = {
  role: string;
  kyc: { pending: number; garantsToCall: number; verified: number } | null;
  moderation: { reportsOpen: number; suspended: number } | null;
  mediation: {
    open: number;
    held: number;
    funded: number;
    released: number;
    payablesToInstruct: number;
    anomalies: number;
    criticalAnomalies: number;
  } | null;
  supervision: { users: number; missions: number; activeMissions: number; backlog: number; adminActions24h: number } | null;
};

/**
 * Dashboard « Admin Métier » — gabarit de flexwork_job (bande de KPI, « Vue détaillée »,
 * « Alertes »), contenu filtré par rôle.
 *
 * Là-bas, le volume financier s'affiche en euros et le « taux de complétion » compte des
 * paiements réussis. Ici la monnaie est le franc CFA, et aucun chiffre n'est dérivé d'une
 * convention d'affichage : chaque KPI est mesuré en base par `/api/admin/dashboard`, et un
 * compteur qu'un rôle n'a pas le droit de lire n'est pas calculé pour lui.
 */
export function AdminDashboard() {
  const role = useAdminRole();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchJson<Dashboard>("/api/admin/dashboard");
    if (res.ok) {
      setData(res.data);
      setError(false);
    } else setError(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (!role) return null;

  const kpis: Kpi[] = [];
  const alerts: { tone: "amber" | "blue" | "red"; text: string; href: string }[] = [];

  if (data?.supervision) {
    kpis.push(
      { icon: "👥", label: "Utilisateurs", value: data.supervision.users.toLocaleString("fr-FR"), hint: "comptes inscrits", href: "/admin/utilisateurs" },
      { icon: "📋", label: "Missions", value: data.supervision.missions, hint: `${data.supervision.activeMissions} actives`, href: "/admin/missions" },
    );
    if (data.supervision.backlog > 0)
      alerts.push({ tone: "blue", text: `${data.supervision.backlog} élément(s) en attente dans les tâches automatiques`, href: "/admin/queues" });
  }
  if (data?.kyc) {
    kpis.push({ icon: "🪪", label: "KYC en attente", value: data.kyc.pending, hint: `${data.kyc.verified} identités vérifiées`, tone: data.kyc.pending > 0 ? "blue" : "neutral", href: "/admin/kyc" });
    if (data.kyc.pending > 0) alerts.push({ tone: "blue", text: `${data.kyc.pending} dossier(s) d’identité à instruire`, href: "/admin/kyc" });
    if (data.kyc.garantsToCall > 0) alerts.push({ tone: "amber", text: `${data.kyc.garantsToCall} garant(s) à appeler`, href: "/admin/validation-utilisateurs" });
  }
  if (data?.moderation) {
    kpis.push({ icon: "🚩", label: "Signalements", value: data.moderation.reportsOpen, hint: "ouverts", tone: data.moderation.reportsOpen > 0 ? "amber" : "neutral", href: "/admin/reports" });
    if (data.moderation.reportsOpen > 0) alerts.push({ tone: "amber", text: `${data.moderation.reportsOpen} signalement(s) en attente de revue`, href: "/admin/reports" });
  }
  if (data?.mediation) {
    kpis.push(
      { icon: "⚖️", label: "Litiges", value: data.mediation.open, hint: "médiations en cours", tone: data.mediation.open > 0 ? "amber" : "neutral", href: "/admin/disputes" },
      { icon: "🔒", label: "Sous séquestre", value: formatXof(data.mediation.held), hint: "détenu par le PSP", tone: "green", href: "/admin/paiements" },
    );
    if (data.mediation.open > 0) alerts.push({ tone: "amber", text: `${data.mediation.open} litige(s) en attente de résolution`, href: "/admin/disputes" });
    if (data.mediation.criticalAnomalies > 0)
      alerts.push({ tone: "red", text: `${data.mediation.criticalAnomalies} anomalie(s) critique(s) sur le séquestre`, href: "/admin/paiements" });
    if (data.mediation.payablesToInstruct > 0)
      alerts.push({ tone: "blue", text: `${data.mediation.payablesToInstruct} somme(s) due(s) à instruire`, href: "/admin/paiements" });
  }

  // « Vue détaillée » : les rubriques du rôle, avec ce qu'elles engagent — la carte de ce que ce
  // pouvoir peut ouvrir, lue dans le registre plutôt que recopiée ici.
  const rubrics = modulesForRole(role, "admin").filter((m) => m.id !== "dashboard" && !m.unavailable);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Dashboard Admin"
        subtitle={`Vue d’ensemble pour le rôle « ${ADMIN_ROLE_META[role].label} » — seuls les indicateurs que ce rôle peut lire.`}
        actions={
          <button onClick={load} className={btnSecondary}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            {loading ? "Actualisation…" : "Actualiser"}
          </button>
        }
      />

      {error && <AdminNotice tone="red">Les indicateurs n’ont pas pu être chargés.</AdminNotice>}

      {data === null ? (
        <div className="flex flex-col overflow-hidden rounded-[16px] border border-[#E2E0D9] bg-white shadow-sm sm:flex-row">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex-1 animate-pulse border-b border-[#E2E0D9] bg-[#FAFAF8] p-4 sm:border-b-0 sm:border-r">
              <div className="mx-auto mb-2 h-4 w-16 rounded bg-[#E2E0D9]" />
              <div className="mx-auto h-6 w-12 rounded bg-[#E2E0D9]" />
            </div>
          ))}
        </div>
      ) : (
        kpis.length > 0 && <KpiStrip items={kpis.slice(0, 5)} />
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <AdminCard title="Vue détaillée" subtitle="Les rubriques de votre pouvoir.">
          <div className="grid grid-cols-2 gap-3">
            {rubrics.map((m) => (
              <Link
                key={m.id}
                href={m.href}
                className="rounded-[12px] border border-[#E2E0D9] bg-[#FAFAF8] p-3 transition hover:border-[#C3D1F8] hover:bg-[#EEF2FD]"
                style={{ textDecoration: "none" }}
              >
                <div className="text-[13px] font-semibold text-[#1A1916]">
                  {m.icon} {m.label}
                </div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-[#5A5750]">{m.hint}</div>
              </Link>
            ))}
          </div>
        </AdminCard>

        <AdminCard title="Alertes">
          <div className="space-y-3">
            {data === null ? (
              <div className="text-[13px] text-[#9C9A95]">Chargement…</div>
            ) : alerts.length === 0 ? (
              <AdminNotice tone="green">✅ Aucune alerte en cours</AdminNotice>
            ) : (
              alerts.map((a) => (
                <Link key={a.text} href={a.href} className="block" style={{ textDecoration: "none" }}>
                  <AdminNotice tone={a.tone}>
                    {a.tone === "red" ? "⛔" : a.tone === "amber" ? "⚠️" : "ℹ️"} {a.text} →
                  </AdminNotice>
                </Link>
              ))
            )}
          </div>
        </AdminCard>
      </div>
    </div>
  );
}
