"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { AutomationTask } from "@/lib/automation-backlog";
import { AdminCard, AdminNotice, AdminPageHeader, KpiStrip, btnSecondary, fetchJson, tableCell, tableHead } from "@/components/admin/admin-ui";

/**
 * Queues — rubrique de flexwork_job, qui y pilote des files BullMQ (pause, relance d'un job).
 *
 * Ici, les tâches automatiques et les files sont exécutées par le worker (src/worker/, pg-boss).
 * Cet écran montre ce qu'elles ont à traiter maintenant — l'arriéré — et rien d'autre. Aucun
 * bouton ne les déclenche : plusieurs déplacent de l'argent, et aucun rôle d'administration n'a
 * ce pouvoir.
 */
type WorkerInfo = { alive: number; lastSeenAt: string | null; stale: boolean; required: boolean };
type OpenAlert = { key: string; severity: string; title: string; detail: string; firstSeenAt: string };

export default function QueuesPage() {
  const [tasks, setTasks] = useState<AutomationTask[] | null>(null);
  const [worker, setWorker] = useState<WorkerInfo | null>(null);
  const [alerts, setAlerts] = useState<OpenAlert[]>([]);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetchJson<{ generatedAt: string; tasks: AutomationTask[]; worker: WorkerInfo; alerts: OpenAlert[] }>("/api/admin/queues");
    if (res.ok) {
      setTasks(res.data.tasks);
      setWorker(res.data.worker);
      setAlerts(res.data.alerts ?? []);
      setGeneratedAt(res.data.generatedAt);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const total = (tasks ?? []).reduce((s, t) => s + t.due, 0);
  const moneyDue = (tasks ?? []).filter((t) => t.movesMoney).reduce((s, t) => s + t.due, 0);

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon="⚙️"
        title="Queues"
        subtitle="Les tâches automatiques et les files du worker, et ce qu’elles ont à traiter maintenant. Cet écran mesure, il ne déclenche rien."
        readOnly
        actions={
          <>
            {generatedAt && <span className="text-[11.5px] text-[#9C9A95]">mesuré à {new Date(generatedAt).toLocaleTimeString("fr-FR")}</span>}
            <button onClick={load} className={btnSecondary}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
              {loading ? "Mesure…" : "Mesurer"}
            </button>
          </>
        }
      />

      <KpiStrip
        items={[
          { icon: "⚙️", label: "Tâches", value: tasks ? tasks.length : "…", hint: "worker et files" },
          { icon: "📥", label: "Arriéré total", value: total, hint: "éléments en attente", tone: total > 0 ? "amber" : "green" },
          { icon: "💶", label: "Dont argent", value: moneyDue, hint: "libérations et remboursements", tone: moneyDue > 0 ? "blue" : "neutral" },
        ]}
      />

      {worker && (
        <AdminNotice tone={worker.stale ? (worker.required ? "red" : "amber") : "green"}>
          {worker.stale
            ? `Aucun worker actif${worker.lastSeenAt ? ` depuis ${new Date(worker.lastSeenAt).toLocaleString("fr-FR")}` : ""}.${
                worker.required ? " Les paiements, webhooks et e-mails ne sont plus traités." : " (Mode inline : rien n’en dépend.)"
              }`
            : `${worker.alive} worker${worker.alive > 1 ? "s" : ""} actif${worker.alive > 1 ? "s" : ""} — dernier passage ${new Date(worker.lastSeenAt!).toLocaleTimeString("fr-FR")}.`}
        </AdminNotice>
      )}

      {alerts.map((a) => (
        <AdminNotice key={a.key} tone={a.severity === "critical" ? "red" : "amber"}>
          <div className="font-semibold">
            {a.severity === "critical" ? "🔴" : "🟠"} {a.title}
            <span className="ml-2 font-normal opacity-75">depuis {new Date(a.firstSeenAt).toLocaleString("fr-FR")}</span>
          </div>
          <div className="mt-1 whitespace-pre-line text-[12.5px]">{a.detail}</div>
        </AdminNotice>
      ))}

      <AdminNotice tone="blue">
        Ces tâches sont exécutées par le worker (<code>npm run worker</code>). Un arriéré qui ne redescend jamais d’une
        mesure à l’autre, ou une ligne marquée ⚠️, signale un worker arrêté ou une intégration en panne.
      </AdminNotice>

      <AdminCard padded={false}>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-[#E2E0D9] bg-[#FAFAF8]">
              <tr>
                <th className={tableHead}>Tâche</th>
                <th className={tableHead}>Effet</th>
                <th className={tableHead}>Fréquence</th>
                <th className={`${tableHead} text-right`}>En attente</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E2E0D9]">
              {(tasks ?? []).map((t) => (
                <tr key={t.key} className="align-top">
                  <td className={tableCell}>
                    <div className="font-medium">
                      {t.label}
                      {t.movesMoney && (
                        <span className="ml-2 rounded-full bg-[#EEF2FD] px-2 py-0.5 text-[10.5px] font-semibold text-[#2D5BE3]">💶 argent</span>
                      )}
                    </div>
                    <div className="font-mono text-[11px] text-[#9C9A95]">{t.route}</div>
                  </td>
                  <td className={`${tableCell} max-w-[360px] text-[#5A5750]`}>{t.effect}</td>
                  <td className={`${tableCell} whitespace-nowrap text-[#5A5750]`}>{t.schedule}</td>
                  <td className={`${tableCell} text-right`}>
                    <span className={`text-[16px] font-bold tabular-nums ${t.due > 0 ? "text-[#B45309]" : "text-[#1A7A4A]"}`}>{t.due}</span>
                    {t.detail && <div className="text-[11px] text-[#9C9A95]">{t.detail}</div>}
                  </td>
                </tr>
              ))}
              {tasks === null && (
                <tr>
                  <td colSpan={4} className="p-5 text-[13px] text-[#9C9A95]">
                    Mesure en cours…
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </AdminCard>
    </div>
  );
}
