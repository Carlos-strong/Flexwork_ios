"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminNav } from "@/components/admin-nav";
import type { Anomaly, ContractFinanceRow, FinanceSnapshot } from "@/lib/admin-finance";
import { ContractDrawer } from "@/components/admin/finance/ContractDrawer";
import { OperationsTable, PayablesTable } from "@/components/admin/finance/LedgerTables";
import { PspJournal } from "@/components/admin/finance/PspJournal";
import { ACTION_ERROR, ANOMALY, Chip, FIN_STATE, MISSION_STATUS, SEVERITY, dateTime, inputCls, money } from "@/components/admin/finance/ui";

// Console des flux financiers (2026-09-15) — tout l'argent de la plateforme, lu depuis le registre
// unique du séquestre : ce qui est entré, ce qui est sorti et vers qui, ce qui reste et pourquoi.
//
// L'ordre de l'écran suit l'ordre des questions d'un opérateur :
//   1. combien, et le registre est-il juste ? (totaux + identité comptable)
//   2. qu'est-ce qui est bloqué et que personne d'autre ne débloquera ? (anomalies)
//   3. où, précisément ? (séquestres, registre, créances — et la fiche de chaque contrat)
//
// Rien ici ne modifie un solde. Les gestes (remboursement, retenue, balayage) passent par leurs
// routes gardées par le rôle Médiation, et chacun est journalisé avec sa justification.

type Snapshot = FinanceSnapshot & { viewerRole: string | null };
type Tab = "sequestres" | "registre" | "creances" | "journal";
type ContractFilter = "all" | "anomalies" | "held" | "missing" | "residual" | "blocked";

const FILTERS: { id: ContractFilter; label: string }[] = [
  { id: "all", label: "Tous" },
  { id: "anomalies", label: "À traiter" },
  { id: "held", label: "Fonds détenus" },
  { id: "missing", label: "Créance non couverte" },
  { id: "residual", label: "Reliquat sur mission close" },
  { id: "blocked", label: "Fonds gelés" },
];

function Kpi({ label, value, hint, tone = "text-[#0f172a]" }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-3.5 min-w-0">
      <div className="text-[10.5px] uppercase tracking-widest text-[#64748B] font-semibold">{label}</div>
      <div className={`text-[18px] lg:text-[20px] font-bold tabular-nums mt-1 truncate ${tone}`}>{value}</div>
      <div className="text-[11.5px] text-[#94A3B8] mt-0.5 truncate">{hint}</div>
    </div>
  );
}

// Où est passé chaque franc financé : une barre, six destinations. La somme des segments EST le
// financé quand l'identité comptable tient — c'est ce que la barre montre d'un coup d'œil.
function FlowBar({ snap }: { snap: Snapshot }) {
  const segments = [
    { label: "Versé aux prestataires", value: snap.total.released, color: "#008751" },
    { label: "Remboursé aux clients", value: snap.total.refunded, color: "#64748B" },
    { label: "Dû au prestataire", value: snap.missions.owedToProvider, color: "#0E9F6E" },
    { label: "Retenue de garantie", value: snap.missions.retained, color: "#D97706" },
    { label: "Gelé (litiges)", value: snap.missions.blocked, color: "#DC2626" },
    { label: "Libre au séquestre", value: snap.missions.refundable, color: "#93C5FD" },
    { label: "Commandes Gig en cours", value: snap.gigs.held, color: "#6366F1" },
  ];
  const base = Math.max(snap.total.funded, segments.reduce((s, x) => s + Math.max(0, x.value), 0), 1);

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <h2 className="text-[13px] font-semibold">Destination des fonds financés</h2>
        {snap.identity.ok ? (
          <Chip tone="green">Identité comptable vérifiée : financé = versé + remboursé + détenu</Chip>
        ) : (
          <Chip tone="red">Écart comptable de {money(snap.identity.gap)}</Chip>
        )}
      </div>
      <div className="flex h-3 rounded-full overflow-hidden bg-[#F1F5F9]" role="img" aria-label="Répartition des fonds financés">
        {segments.map((s) =>
          s.value > 0 ? <div key={s.label} style={{ width: `${(s.value / base) * 100}%`, background: s.color }} title={`${s.label} : ${money(s.value)}`} /> : null
        )}
      </div>
      <ul className="mt-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-5 gap-y-1.5 text-[12px]">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-2 min-w-0">
            <span className="flex items-center gap-1.5 text-[#475569] min-w-0">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
              <span className="truncate">{s.label}</span>
            </span>
            <span className="tabular-nums text-[#0f172a] shrink-0">{money(s.value)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AnomalyPanel({ anomalies, onOpen }: { anomalies: Anomaly[]; onOpen: (contractId: string) => void }) {
  const [all, setAll] = useState(false);
  const shown = all ? anomalies : anomalies.slice(0, 6);
  const counts = anomalies.reduce<Record<string, number>>((acc, a) => ({ ...acc, [a.severity]: (acc[a.severity] ?? 0) + 1 }), {});

  if (anomalies.length === 0) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 text-[13px] text-[#00623A] flex items-center gap-2">
        <span className="w-2 h-2 rounded-full bg-[#008751]" />
        Aucune anomalie : aucun fonds immobilisé sans issue, aucune instruction en souffrance.
      </div>
    );
  }

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
      <div className="px-4 lg:px-5 py-3 border-b border-[#F1F5F9] flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-[13px] font-semibold">À traiter ({anomalies.length})</h2>
        <div className="flex items-center gap-1.5">
          {(["critical", "warning", "info"] as const).map((s) =>
            counts[s] ? (
              <Chip key={s} tone={SEVERITY[s].tone}>
                {counts[s]} {SEVERITY[s].label.toLowerCase()}
              </Chip>
            ) : null
          )}
        </div>
      </div>
      <ul className="divide-y divide-[#F1F5F9]">
        {shown.map((a) => (
          <li key={a.id} className="px-4 lg:px-5 py-2.5 flex items-start gap-3">
            <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEVERITY[a.severity].dot}`} aria-label={SEVERITY[a.severity].label} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap text-[12.5px]">
                <strong className="text-[#0f172a]">{ANOMALY[a.kind]?.label ?? a.kind}</strong>
                <span className="text-[#475569] truncate">{a.title}</span>
              </div>
              <p className="text-[12px] text-[#64748B] mt-0.5">{a.detail}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {a.amount > 0 && <span className="text-[12.5px] font-semibold tabular-nums">{money(a.amount)}</span>}
              {a.contractId && (
                <button onClick={() => onOpen(a.contractId!)} className="h-8 px-3 rounded-lg border border-[#E2E8F0] bg-white text-[12px] font-medium hover:bg-[#F8FAF9]">
                  Ouvrir
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {anomalies.length > 6 && (
        <button onClick={() => setAll((v) => !v)} className="w-full py-2 text-[12px] font-medium text-[#008751] border-t border-[#F1F5F9] hover:bg-[#F8FAF9]">
          {all ? "Réduire" : `Voir les ${anomalies.length - 6} autres`}
        </button>
      )}
    </div>
  );
}

function ContractsTable({
  rows,
  anomaliesByContract,
  onOpen,
}: {
  rows: ContractFinanceRow[];
  anomaliesByContract: Map<string, Anomaly[]>;
  onOpen: (id: string) => void;
}) {
  const [filter, setFilter] = useState<ContractFilter>("all");
  const [q, setQ] = useState("");

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => {
        const anomalies = anomaliesByContract.get(r.contractId) ?? [];
        switch (filter) {
          case "anomalies":
            return anomalies.length > 0;
          case "held":
            return r.balance.held > 0;
          case "missing":
            return r.missing > 0;
          case "residual":
            return anomalies.some((a) => a.kind === "residual_on_closed");
          case "blocked":
            return r.balance.blocked > 0;
          default:
            return true;
        }
      })
      .filter(
        (r) =>
          !needle ||
          [r.titre, r.contractId, r.missionId, r.client.name, r.client.email, r.provider.name, r.provider.email]
            .filter(Boolean)
            .some((v) => String(v).toLowerCase().includes(needle))
      )
      .sort(
        (a, b) =>
          (anomaliesByContract.get(b.contractId)?.length ?? 0) - (anomaliesByContract.get(a.contractId)?.length ?? 0) ||
          b.balance.held - a.balance.held
      );
  }, [rows, anomaliesByContract, filter, q]);

  const th = "text-left py-2.5 px-3 font-semibold whitespace-nowrap";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className={`h-8 px-3 rounded-full border text-[12px] font-medium transition-colors ${
              filter === f.id ? "bg-[#0f172a] border-[#0f172a] text-white" : "bg-white border-[#E2E8F0] text-[#475569] hover:border-[#94A3B8]"
            }`}
          >
            {f.label}
          </button>
        ))}
        <input
          id="contracts-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Mission, partie, identifiant…"
          aria-label="Rechercher un contrat"
          className={`${inputCls} max-w-[280px] ml-auto`}
        />
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[980px]">
            <thead>
              <tr className="text-[10.5px] tracking-widest text-[#64748B] uppercase bg-[#F8FAF9] border-b border-[#E2E8F0]">
                <th className={th}>Mission</th>
                <th className={th}>État</th>
                <th className={`${th} text-right`}>Financé</th>
                <th className={`${th} text-right`}>Versé</th>
                <th className={`${th} text-right`}>Remboursé</th>
                <th className={`${th} text-right`}>Détenu</th>
                <th className={`${th} text-right`}>Gelé / retenu</th>
                <th className={`${th} text-right`}>Non couvert</th>
                <th className={th}>Dernier mouvement</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const anomalies = anomaliesByContract.get(r.contractId) ?? [];
                const worst = anomalies[0]?.severity;
                return (
                  <tr
                    key={r.contractId}
                    onClick={() => onOpen(r.contractId)}
                    onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(r.contractId)}
                    tabIndex={0}
                    className="border-b border-[#F1F5F9] last:border-0 cursor-pointer hover:bg-[#F8FAF9] focus:outline-none focus-visible:bg-[#EFF6FF]"
                  >
                    <td className="py-2.5 px-3 max-w-[300px]">
                      <div className="flex items-center gap-1.5 min-w-0">
                        {worst && <span className={`w-2 h-2 rounded-full shrink-0 ${SEVERITY[worst].dot}`} aria-label={`${anomalies.length} anomalie(s)`} />}
                        <span className="font-semibold text-[#0f172a] truncate">{r.titre}</span>
                      </div>
                      <div className="text-[11px] text-[#94A3B8] truncate">
                        {r.client.name} → {r.provider.name} · {MISSION_STATUS[r.missionStatus] ?? r.missionStatus}
                        {r.isTimeContract ? " · au temps" : ""}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <Chip tone={FIN_STATE[r.financialState]?.tone ?? "slate"}>{FIN_STATE[r.financialState]?.label ?? r.financialState}</Chip>
                      {r.pendingOperations > 0 && <div className="text-[11px] text-[#92400E] mt-0.5">{r.pendingOperations} en attente PSP</div>}
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{money(r.balance.funded, r.currency)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-[#008751]">{money(r.balance.released, r.currency)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">{money(r.balance.refunded, r.currency)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums font-semibold">{money(r.balance.held, r.currency)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      <span className={r.balance.blocked > 0 ? "text-[#B91C1C]" : "text-[#94A3B8]"}>{money(r.balance.blocked, r.currency)}</span>
                      <span className="text-[#CBD5E1]"> / </span>
                      <span className={r.balance.retained > 0 ? "text-[#92400E]" : "text-[#94A3B8]"}>{money(r.balance.retained, r.currency)}</span>
                    </td>
                    <td className={`py-2.5 px-3 text-right tabular-nums ${r.missing > 0 ? "text-[#92400E] font-semibold" : "text-[#94A3B8]"}`}>
                      {money(r.missing, r.currency)}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap text-[#475569] tabular-nums">{dateTime(r.lastMovementAt)}</td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={9} className="py-6 text-center text-[#94A3B8]">Aucun contrat ne correspond à ces filtres.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-[#F1F5F9] text-[12px] text-[#64748B]">
          {visible.length} contrat{visible.length > 1 ? "s" : ""} sur {rows.length}
        </div>
      </div>
    </div>
  );
}

function SweepDialog({ residualCount, residualAmount, onClose, onDone }: { residualCount: number; residualAmount: number; onClose: () => void; onDone: (message: string) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/admin/finance/residual-sweep", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ justification: reason }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(ACTION_ERROR[data.error] ?? `Échec : ${data.error ?? res.status}`);
      return;
    }
    onDone(
      data.refunded > 0
        ? `${data.refunded} reliquat${data.refunded > 1 ? "s" : ""} remboursé${data.refunded > 1 ? "s" : ""} — ${money(data.amount)} instruits.`
        : "Aucun reliquat à rembourser sur les missions terminées."
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="sweep-title">
      <div className="absolute inset-0 bg-[#0f172a]/40" onClick={onClose} />
      <div className="relative w-full max-w-[460px] bg-white rounded-xl border border-[#E2E8F0] p-5 space-y-3 shadow-2xl">
        <h3 id="sweep-title" className="text-[15px] font-bold">Balayer les reliquats</h3>
        <p className="text-[12.5px] text-[#475569] leading-relaxed">
          Rembourse au client le solde disponible de chaque mission <strong>clôturée ou remboursée</strong>. Les fonds gelés et les retenues ne
          partent pas. Même traitement que le passage quotidien : relancer ne rembourse jamais deux fois.
        </p>
        <p className="text-[12.5px] rounded-lg bg-[#F8FAF9] border border-[#E2E8F0] px-3 py-2 tabular-nums">
          Repéré à l&apos;instant : {residualCount} reliquat{residualCount > 1 ? "s" : ""}, {money(residualAmount)}.
        </p>
        <label htmlFor="sweep-justification" className="block text-[12px] font-medium text-[#475569]">
          Justification (journalisée)
        </label>
        <input id="sweep-justification" type="text" value={reason} onChange={(e) => setReason(e.target.value)} className={inputCls} autoFocus />
        {error && <p className="text-[12px] text-[#B91C1C]" role="alert">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#E2E8F0] bg-white text-[12.5px] font-medium hover:bg-[#F8FAF9]">
            Annuler
          </button>
          <button
            onClick={run}
            disabled={busy || reason.trim().length < 5}
            className="h-9 px-4 rounded-lg bg-[#0f172a] text-white text-[12.5px] font-semibold hover:bg-black disabled:opacity-40"
          >
            {busy ? "Balayage…" : "Lancer le balayage"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminFinancePage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<"forbidden" | "failed" | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [tab, setTab] = useState<Tab>("sequestres");
  const [selected, setSelected] = useState<string | null>(null);
  const [sweepOpen, setSweepOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const load = useCallback(async () => {
    setRefreshing(true);
    const res = await fetch("/api/admin/finance", { cache: "no-store" }).catch(() => null);
    setRefreshing(false);
    if (!res?.ok) {
      setError(res && (res.status === 401 || res.status === 403) ? "forbidden" : "failed");
      return;
    }
    setSnap(await res.json());
    setError(null);
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  const anomaliesByContract = useMemo(() => {
    const map = new Map<string, Anomaly[]>();
    for (const a of snap?.anomalies ?? []) {
      if (!a.contractId) continue;
      map.set(a.contractId, [...(map.get(a.contractId) ?? []), a]);
    }
    return map;
  }, [snap]);

  const residuals = (snap?.anomalies ?? []).filter((a) => a.kind === "residual_on_closed");
  const canAct = snap?.viewerRole === "mediation";

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <AdminNav />
      <div className="max-w-[1400px] mx-auto px-4 py-5 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[18px] font-bold">Flux financiers</h1>
            <p className="text-[12.5px] text-[#64748B] mt-0.5 max-w-[70ch]">
              Registre unique du séquestre, missions et commandes Gig. La plateforme instruit, le PSP détient : aucun solde n&apos;est
              écrit ici, chaque geste est journalisé.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {snap && <span className="text-[11.5px] text-[#94A3B8] tabular-nums">Mis à jour {dateTime(snap.generatedAt)}</span>}
            <button
              onClick={load}
              disabled={refreshing}
              className="h-9 px-3.5 rounded-lg border border-[#E2E8F0] bg-white text-[12.5px] font-medium hover:bg-[#F1F5F9] disabled:opacity-50"
            >
              {refreshing ? "Actualisation…" : "Actualiser"}
            </button>
            <button
              onClick={() => setSweepOpen(true)}
              disabled={!canAct}
              title={canAct ? undefined : "Réservé au rôle admin Médiation"}
              className="h-9 px-3.5 rounded-lg bg-[#0f172a] text-white text-[12.5px] font-semibold hover:bg-black disabled:opacity-40"
            >
              Balayer les reliquats
            </button>
          </div>
        </div>

        {error === "forbidden" && (
          <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-[13px] text-[#B91C1C]">
            Accès réservé aux administrateurs Superviseur et Médiation.
          </div>
        )}
        {error === "failed" && (
          <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-4 text-[13px] text-[#B91C1C]">
            Les flux financiers n&apos;ont pas pu être chargés. Réessayez avec « Actualiser ».
          </div>
        )}
        {!snap && !error && <div className="py-16 text-center text-[13px] text-[#64748B]">Chargement du registre…</div>}

        {snap && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
              <Kpi label="Financé" value={money(snap.total.funded)} hint={`${snap.missions.contracts} contrats · ${snap.gigs.orders} commandes Gig`} />
              <Kpi label="Versé aux prestataires" value={money(snap.total.released)} hint="confirmé ou en vol" tone="text-[#008751]" />
              <Kpi label="Remboursé aux clients" value={money(snap.total.refunded)} hint="confirmé ou en vol" />
              <Kpi label="Sous séquestre" value={money(snap.total.held)} hint={`dont ${money(snap.missions.blocked)} gelés`} />
              <Kpi
                label="En attente PSP"
                value={money(snap.pending.amount)}
                hint={`${snap.pending.count} instruction${snap.pending.count > 1 ? "s" : ""}`}
                tone={snap.pending.count > 0 ? "text-[#92400E]" : undefined}
              />
              <Kpi
                label="Échecs (30 j)"
                value={String(snap.failedLast30Days.count)}
                hint={money(snap.failedLast30Days.amount)}
                tone={snap.failedLast30Days.count > 0 ? "text-[#B91C1C]" : undefined}
              />
            </div>

            <FlowBar snap={snap} />

            <AnomalyPanel anomalies={snap.anomalies} onOpen={setSelected} />

            <div className="flex items-center gap-1 border-b border-[#E2E8F0]" role="tablist">
              {(
                [
                  ["sequestres", `Séquestres (${snap.rows.length})`],
                  ["registre", "Registre PSP"],
                  ["creances", `Créances (${Object.values(snap.payables).reduce((s, p) => s + p.count, 0)})`],
                  ["journal", "Journal PSP"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`h-10 px-3.5 text-[13px] font-medium border-b-2 -mb-px transition-colors ${
                    tab === id ? "border-[#008751] text-[#0f172a]" : "border-transparent text-[#64748B] hover:text-[#0f172a]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {tab === "sequestres" && <ContractsTable rows={snap.rows} anomaliesByContract={anomaliesByContract} onOpen={setSelected} />}
            {tab === "registre" && <OperationsTable onOpenContract={setSelected} refreshKey={refreshKey} />}
            {tab === "creances" && <PayablesTable onOpenContract={setSelected} refreshKey={refreshKey} />}
            {tab === "journal" && <PspJournal onOpenContract={setSelected} refreshKey={refreshKey} />}
          </>
        )}
      </div>

      {selected && (
        <ContractDrawer contractId={selected} onClose={() => setSelected(null)} onChanged={load} notify={setToast} />
      )}

      {sweepOpen && snap && (
        <SweepDialog
          residualCount={residuals.length}
          residualAmount={residuals.reduce((s, a) => s + a.amount, 0)}
          onClose={() => setSweepOpen(false)}
          onDone={(message) => {
            setSweepOpen(false);
            setToast(message);
            load();
          }}
        />
      )}

      {toast && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] bg-[#0f172a] text-white px-4 py-2.5 rounded-full text-[13px] font-medium shadow-2xl max-w-[92vw]"
          role="status"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
