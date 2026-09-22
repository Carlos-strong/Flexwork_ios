"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { FinanceSnapshot } from "@/lib/admin-finance";
import { ANOMALY, PAYABLE_STATUS, SEVERITY } from "@/components/admin/finance/ui";
import { useAdminRole } from "@/components/admin/admin-role-context";
import {
  AdminCard,
  AdminEmpty,
  AdminNotice,
  AdminPageHeader,
  KpiStrip,
  btnPrimary,
  fetchJson,
  formatXof,
  tableCell,
  tableHead,
} from "@/components/admin/admin-ui";

/**
 * Finance — rubrique du Back Office de flexwork_job (« CA, Commissions, Escrow »).
 *
 * Seul l'escrow a une contrepartie ici : la plateforme ne perçoit ni chiffre d'affaires ni
 * commission dans le schéma v3, le PSP détient les fonds (§6). Cet écran est donc la SYNTHÈSE
 * du séquestre, en lecture. Les gestes — balayer un reliquat, rembourser, solder une retenue —
 * restent dans « Paiements », sous le seul rôle Médiation : une synthèse qui porterait aussi des
 * boutons serait un second endroit où la garde pourrait diverger.
 */
export default function BackOfficeFinancePage() {
  const role = useAdminRole();
  const [snap, setSnap] = useState<FinanceSnapshot | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetchJson<FinanceSnapshot>("/api/admin/finance").then((r) => (r.ok ? setSnap(r.data) : setError(true)));
  }, []);

  const bySeverity = (snap?.anomalies ?? []).reduce<Record<string, number>>((acc, a) => {
    acc[a.severity] = (acc[a.severity] ?? 0) + 1;
    return acc;
  }, {});
  const byKind = (snap?.anomalies ?? []).reduce<Record<string, { count: number; amount: number }>>((acc, a) => {
    const entry = (acc[a.kind] ??= { count: 0, amount: 0 });
    entry.count++;
    entry.amount += a.amount;
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <AdminPageHeader
        icon="💰"
        title="Finance"
        subtitle="Synthèse du séquestre. La plateforme ne détient ni ne perçoit rien : le PSP tient les fonds, et aucun modèle de commission n’existe dans le schéma v3."
        readOnly
        actions={
          role === "mediation" ? (
            <Link href="/admin/paiements" className={btnPrimary} style={{ textDecoration: "none" }}>
              Agir dans Paiements →
            </Link>
          ) : undefined
        }
      />

      {error && <AdminNotice tone="red">La synthèse financière n’a pas pu être chargée.</AdminNotice>}

      {snap && (
        <>
          <KpiStrip
            items={[
              { icon: "📥", label: "Versé au séquestre", value: formatXof(snap.total.funded), hint: "financements confirmés" },
              { icon: "📤", label: "Libéré", value: formatXof(snap.total.released), hint: "payé aux prestataires", tone: "green" },
              { icon: "↩️", label: "Remboursé", value: formatXof(snap.total.refunded), hint: "rendu aux clients" },
              { icon: "🔒", label: "Détenu", value: formatXof(snap.total.held), hint: "encore sous séquestre", tone: "blue" },
            ]}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <AdminCard title="Par canal" padded={false}>
              <table className="w-full">
                <thead className="border-b border-[#E2E0D9] bg-[#FAFAF8]">
                  <tr>
                    <th className={tableHead}>Canal</th>
                    <th className={`${tableHead} text-right`}>Versé</th>
                    <th className={`${tableHead} text-right`}>Libéré</th>
                    <th className={`${tableHead} text-right`}>Détenu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#E2E0D9]">
                  <tr>
                    <td className={tableCell}>
                      Missions <span className="text-[11px] text-[#9C9A95]">· {snap.missions.contracts} contrats</span>
                    </td>
                    <td className={`${tableCell} text-right tabular-nums`}>{formatXof(snap.missions.funded)}</td>
                    <td className={`${tableCell} text-right tabular-nums`}>{formatXof(snap.missions.released)}</td>
                    <td className={`${tableCell} text-right tabular-nums`}>{formatXof(snap.missions.held)}</td>
                  </tr>
                  <tr>
                    <td className={tableCell}>
                      Gigs <span className="text-[11px] text-[#9C9A95]">· {snap.gigs.orders} commandes</span>
                    </td>
                    <td className={`${tableCell} text-right tabular-nums`}>{formatXof(snap.gigs.funded)}</td>
                    <td className={`${tableCell} text-right tabular-nums`}>{formatXof(snap.gigs.released)}</td>
                    <td className={`${tableCell} text-right tabular-nums`}>{formatXof(snap.gigs.held)}</td>
                  </tr>
                </tbody>
              </table>
              <div className="border-t border-[#E2E0D9] px-5 py-3 text-[12px] text-[#5A5750]">
                Dû au prestataire {formatXof(snap.missions.owedToProvider)} · gelé {formatXof(snap.missions.blocked)} · retenue{" "}
                {formatXof(snap.missions.retained)} · restituable {formatXof(snap.missions.refundable)}
                {snap.missions.missing > 0 && <span className="font-semibold text-[#B42318]"> · non couvert {formatXof(snap.missions.missing)}</span>}
              </div>
            </AdminCard>

            <AdminCard title="Sommes dues" subtitle="Payables par statut." padded={false}>
              <table className="w-full">
                <tbody className="divide-y divide-[#E2E0D9]">
                  {Object.entries(snap.payables).map(([status, v]) => (
                    <tr key={status}>
                      <td className={tableCell}>{PAYABLE_STATUS[status]?.label ?? status}</td>
                      <td className={`${tableCell} text-right tabular-nums`}>{v.count}</td>
                      <td className={`${tableCell} text-right tabular-nums`}>{formatXof(v.amount)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className={tableCell}>Opérations PSP en vol</td>
                    <td className={`${tableCell} text-right tabular-nums`}>{snap.pending.count}</td>
                    <td className={`${tableCell} text-right tabular-nums`}>{formatXof(snap.pending.amount)}</td>
                  </tr>
                </tbody>
              </table>
            </AdminCard>
          </div>

          <AdminCard
            title="Anomalies"
            subtitle={
              snap.identity.ok
                ? "L’identité comptable du séquestre est vérifiée : versé = libéré + remboursé + détenu."
                : `Écart d’identité comptable : ${formatXof(snap.identity.gap)}.`
            }
            padded={false}
          >
            {snap.anomalies.length === 0 ? (
              <div className="p-5">
                <AdminEmpty>Aucune anomalie détectée.</AdminEmpty>
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 border-b border-[#E2E0D9] px-5 py-3">
                  {Object.entries(bySeverity).map(([sev, n]) => (
                    <span key={sev} className="rounded-full border border-[#E2E0D9] bg-[#FAFAF8] px-2.5 py-0.5 text-[11.5px] font-semibold text-[#5A5750]">
                      {SEVERITY[sev]?.label ?? sev} · {n}
                    </span>
                  ))}
                </div>
                <table className="w-full">
                  <tbody className="divide-y divide-[#E2E0D9]">
                    {Object.entries(byKind).map(([kind, v]) => (
                      <tr key={kind}>
                        <td className={tableCell}>{ANOMALY[kind]?.label ?? kind}</td>
                        <td className={`${tableCell} text-right tabular-nums`}>{v.count}</td>
                        <td className={`${tableCell} text-right tabular-nums`}>{formatXof(v.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </AdminCard>
        </>
      )}
    </div>
  );
}
