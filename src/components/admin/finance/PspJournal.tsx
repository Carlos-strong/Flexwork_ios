"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JournalItem, JournalStats, PspExchange } from "@/lib/psp-journal";
import {
  Chip,
  OP_STATUS,
  OP_TYPE,
  PSP_CHANNEL,
  PSP_ERROR,
  PSP_EVENT,
  PSP_OUTCOME,
  dateTime,
  duration,
  inputCls,
  money,
  selectCls,
} from "./ui";

// Journal des échanges plateforme ⇄ PSP — ce qui est parti, ce qui est revenu, et ce que la
// plateforme en a fait. Là où le registre ne dit que l'état final d'une instruction, le journal
// raconte la conversation : un webhook rejoué, une signature refusée, une référence inconnue.

type Period = "24h" | "7d" | "30d" | "all";
const PERIODS: { id: Period; label: string }[] = [
  { id: "24h", label: "24 h" },
  { id: "7d", label: "7 jours" },
  { id: "30d", label: "30 jours" },
  { id: "all", label: "Tout" },
];

function useDebounced<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

function Stat({ label, value, hint, tone = "text-[#0f172a]" }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl p-3 min-w-0">
      <div className="text-[10.5px] uppercase tracking-widest text-[#64748B] font-semibold truncate">{label}</div>
      <div className={`text-[18px] font-bold tabular-nums mt-0.5 truncate ${tone}`}>{value}</div>
      <div className="text-[11px] text-[#94A3B8] truncate">{hint}</div>
    </div>
  );
}

function Direction({ kind }: { kind: JournalItem["kind"] }) {
  return kind === "outbound" ? (
    <Chip tone="blue">Plateforme → PSP</Chip>
  ) : (
    <Chip tone="dark">PSP → Plateforme</Chip>
  );
}

function ExchangeDrawer({ reference, onClose, onOpenContract }: { reference: string; onClose: () => void; onOpenContract: (id: string) => void }) {
  const [data, setData] = useState<PspExchange | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    fetch(`/api/admin/finance/psp-journal/exchange?reference=${encodeURIComponent(reference)}`, { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error(r.status === 404 ? "Aucun échange pour cette référence." : "L'échange n'a pas pu être chargé.");
        setData(await r.json());
      })
      .catch((e: Error) => setError(e.message));
  }, [reference]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const op = data?.operation;
  const sentAt = op ? new Date(op.instructionSentAt).getTime() : null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Échange avec le PSP">
      <div className="absolute inset-0 bg-[#0f172a]/40" onClick={onClose} />
      <div className="relative w-full max-w-[560px] h-full bg-[#F8FAF9] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 z-10 bg-white border-b border-[#E2E8F0] px-4 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-[#94A3B8]">Échange avec le PSP</div>
            <h2 className="text-[13px] font-bold font-mono text-[#0f172a] break-all">{reference}</h2>
          </div>
          <button onClick={onClose} className="shrink-0 h-8 w-8 rounded-lg border border-[#E2E8F0] bg-white text-[#475569] hover:bg-[#F1F5F9]" aria-label="Fermer">
            ✕
          </button>
        </div>

        {error && <p className="m-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C]">{error}</p>}
        {!data && !error && <p className="p-6 text-center text-[13px] text-[#64748B]">Chargement…</p>}

        {data && (
          <div className="p-4 space-y-4">
            {op ? (
              <section className="rounded-xl border border-[#E2E8F0] bg-white p-3.5 text-[12.5px] space-y-1.5">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Chip tone={OP_TYPE[op.instructionType]?.tone ?? "slate"}>{OP_TYPE[op.instructionType]?.label ?? op.instructionType}</Chip>
                  <Chip tone={OP_STATUS[op.status]?.tone ?? "slate"}>{OP_STATUS[op.status]?.label ?? op.status}</Chip>
                  <strong className="ml-auto tabular-nums">{money(op.amount, op.currency)}</strong>
                </div>
                <div className="text-[#475569]">
                  {op.contractId ? (
                    <button onClick={() => onOpenContract(op.contractId!)} className="text-[#008751] font-medium hover:underline">
                      {op.label}
                    </button>
                  ) : (
                    op.label
                  )}{" "}
                  · {op.pspName}
                </div>
                <div className="text-[#64748B] tabular-nums">
                  Transmise {dateTime(op.instructionSentAt)} · {op.pspConfirmedAt ? `dénouée ${dateTime(op.pspConfirmedAt)} (${duration(new Date(op.pspConfirmedAt).getTime() - sentAt!)})` : "aucun dénouement enregistré"}
                </div>
              </section>
            ) : (
              <p className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[12.5px] text-[#B91C1C]">
                Aucune instruction de la plateforme ne porte cette référence : le PSP — ou un tiers — a présenté un message sans objet.
              </p>
            )}

            <ol className="relative border-l-2 border-[#E2E8F0] ml-2 space-y-3">
              {op && (
                <li className="ml-4">
                  <span className="absolute -left-[7px] w-3 h-3 rounded-full bg-[#1E40AF] ring-2 ring-white" />
                  <div className="text-[11px] text-[#94A3B8] tabular-nums">{dateTime(op.instructionSentAt)}</div>
                  <div className="text-[12.5px] font-semibold">Instruction transmise au PSP</div>
                </li>
              )}
              {data.events.map((ev) => {
                const o = PSP_OUTCOME[ev.outcome];
                return (
                  <li key={ev.id} className="ml-4">
                    <span
                      className={`absolute -left-[7px] w-3 h-3 rounded-full ring-2 ring-white ${
                        ev.outcome === "applied" ? "bg-[#008751]" : ev.outcome === "replayed" ? "bg-[#93C5FD]" : "bg-[#DC2626]"
                      }`}
                    />
                    <div className="text-[11px] text-[#94A3B8] tabular-nums">
                      {dateTime(ev.receivedAt)}
                      {sentAt !== null && ` · +${duration(new Date(ev.receivedAt).getTime() - sentAt)} après l'instruction`}
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                      <strong className="text-[12.5px]">{PSP_EVENT[ev.event] ?? ev.event}</strong>
                      <Chip tone={o?.tone ?? "slate"}>{o?.label ?? ev.outcome}</Chip>
                      {ev.error && <Chip tone="red">{PSP_ERROR[ev.error] ?? ev.error}</Chip>}
                    </div>
                    <div className="text-[11.5px] text-[#64748B] mt-0.5">
                      {PSP_CHANNEL[ev.channel] ?? ev.channel} · signature {ev.signatureValid ? "valide" : "invalide"} · traité en {duration(ev.durationMs)}
                    </div>
                    <details className="mt-1">
                      <summary className="text-[11.5px] text-[#008751] cursor-pointer">Charge reçue</summary>
                      <pre className="mt-1 rounded-lg bg-[#0f172a] text-[#E2E8F0] text-[11px] p-2.5 overflow-x-auto">{JSON.stringify(ev.payload, null, 2)}</pre>
                    </details>
                  </li>
                );
              })}
              {data.events.length === 0 && (
                <li className="ml-4 text-[12.5px] text-[#92400E]">Aucun message reçu du PSP pour cette instruction.</li>
              )}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

export function PspJournal({ onOpenContract, refreshKey }: { onOpenContract: (id: string) => void; refreshKey: number }) {
  const [period, setPeriod] = useState<Period>("7d");
  const [direction, setDirection] = useState("");
  const [outcome, setOutcome] = useState("");
  const [channel, setChannel] = useState("");
  const [error, setError] = useState("");
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const dq = useDebounced(q);

  const [stats, setStats] = useState<JournalStats | null>(null);
  const [items, setItems] = useState<JournalItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [exchange, setExchange] = useState<string | null>(null);
  const requestId = useRef(0);

  const url = useCallback(
    (next: string | null) => {
      const p = new URLSearchParams({ period });
      if (direction) p.set("direction", direction);
      if (outcome) p.set("outcome", outcome);
      if (channel) p.set("channel", channel);
      if (error) p.set("error", error);
      if (type) p.set("type", type);
      if (dq.trim()) p.set("q", dq.trim());
      if (next) p.set("cursor", next);
      return `/api/admin/finance/psp-journal?${p}`;
    },
    [period, direction, outcome, channel, error, type, dq]
  );

  const load = useCallback(
    async (next: string | null) => {
      const id = ++requestId.current;
      setLoading(true);
      const res = await fetch(url(next), { cache: "no-store" }).catch(() => null);
      if (id !== requestId.current) return;
      setLoading(false);
      if (!res?.ok) {
        setFailed(true);
        return;
      }
      const data = (await res.json()) as { items: JournalItem[]; nextCursor: string | null; stats: JournalStats | null };
      setFailed(false);
      if (data.stats) setStats(data.stats);
      setItems((prev) => (next ? [...prev, ...data.items] : data.items));
      setCursor(data.nextCursor);
    },
    [url]
  );

  useEffect(() => {
    load(null);
  }, [load, refreshKey]);

  const resetFilters = () => {
    setDirection("");
    setOutcome("");
    setChannel("");
    setError("");
    setType("");
    setQ("");
  };
  const filtered = !!(direction || outcome || channel || error || type || q);
  const th = "text-left py-2.5 px-3 font-semibold whitespace-nowrap";

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12.5px] text-[#64748B] max-w-[75ch]">
          Chaque instruction transmise au PSP et chaque message reçu en retour, avec ce que la plateforme en a fait. Les messages rejetés — signature
          invalide, référence inconnue — sont conservés : ce sont les plus importants à voir.
        </p>
        <div className="inline-flex rounded-lg border border-[#E2E8F0] bg-white p-0.5" role="group" aria-label="Période">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              aria-pressed={period === p.id}
              className={`h-8 px-3 rounded-md text-[12px] font-medium ${period === p.id ? "bg-[#0f172a] text-white" : "text-[#475569] hover:bg-[#F1F5F9]"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {stats && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Stat label="Instructions transmises" value={String(stats.outbound)} hint={`${stats.pendingNow} en attente de réponse`} />
            <Stat label="Messages reçus" value={String(stats.inbound.total)} hint={`${stats.inbound.applied} appliqués`} />
            <Stat label="Rejeux ignorés" value={String(stats.inbound.replayed)} hint="doublons du PSP, sans effet" />
            <Stat
              label="Messages rejetés"
              value={String(stats.inbound.rejected)}
              hint={stats.rejectionsByError[0] ? `surtout : ${PSP_ERROR[stats.rejectionsByError[0].error] ?? stats.rejectionsByError[0].error}` : "aucun"}
              tone={stats.inbound.rejected > 0 ? "text-[#B91C1C]" : undefined}
            />
            <Stat
              label="Sans réponse > 24 h"
              value={String(stats.unanswered)}
              hint="instructions jamais dénouées"
              tone={stats.unanswered > 0 ? "text-[#92400E]" : undefined}
            />
            <Stat
              label="Délai de confirmation"
              value={duration(stats.confirmation.payouts.medianMs)}
              hint={`médiane versements · p95 ${duration(stats.confirmation.payouts.p95Ms)}`}
            />
          </div>

          {stats.rejectionsByError.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap text-[12px]">
              <span className="text-[#64748B]">Motifs de rejet :</span>
              {stats.rejectionsByError.map((r) => (
                <button
                  key={r.error}
                  onClick={() => {
                    setOutcome("rejected");
                    setError(r.error === "unknown" ? "" : r.error);
                  }}
                  aria-pressed={error === r.error}
                  className={`h-7 px-2.5 rounded-full border text-[11.5px] font-medium ${
                    error === r.error ? "bg-[#B91C1C] border-[#B91C1C] text-white" : "bg-white border-[#FECACA] text-[#B91C1C] hover:bg-[#FEF2F2]"
                  }`}
                >
                  {PSP_ERROR[r.error] ?? r.error} · {r.count}
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select id="journal-direction" aria-label="Sens" value={direction} onChange={(e) => setDirection(e.target.value)} className={selectCls}>
          <option value="">Les deux sens</option>
          <option value="outbound">Plateforme → PSP</option>
          <option value="inbound">PSP → Plateforme</option>
        </select>
        <select id="journal-outcome" aria-label="Résultat" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={selectCls}>
          <option value="">Tous les résultats</option>
          {Object.entries(PSP_OUTCOME).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <select id="journal-channel" aria-label="Canal" value={channel} onChange={(e) => setChannel(e.target.value)} className={selectCls}>
          <option value="">Tous les canaux</option>
          {Object.entries(PSP_CHANNEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select id="journal-type" aria-label="Type d'instruction" value={type} onChange={(e) => setType(e.target.value)} className={selectCls}>
          <option value="">Toutes les instructions</option>
          {Object.entries(OP_TYPE).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <input
          id="journal-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Référence PSP, identifiant…"
          aria-label="Rechercher dans le journal"
          className={`${inputCls} max-w-[280px]`}
        />
        {filtered && (
          <button onClick={resetFilters} className="h-9 px-3 text-[12px] font-medium text-[#008751] hover:underline">
            Effacer les filtres
          </button>
        )}
      </div>

      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[1020px]">
            <thead>
              <tr className="text-[10.5px] tracking-widest text-[#64748B] uppercase bg-[#F8FAF9] border-b border-[#E2E8F0]">
                <th className={th}>Horodatage</th>
                <th className={th}>Sens</th>
                <th className={th}>Message</th>
                <th className={th}>Référence PSP</th>
                <th className={th}>Portée</th>
                <th className={`${th} text-right`}>Montant</th>
                <th className={th}>Résultat</th>
                <th className={th}>Délai</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.key} className="border-b border-[#F1F5F9] last:border-0 hover:bg-[#F8FAF9] align-top">
                  <td className="py-2 px-3 whitespace-nowrap text-[#475569] tabular-nums">{dateTime(it.at)}</td>
                  <td className="py-2 px-3">
                    <Direction kind={it.kind} />
                  </td>
                  <td className="py-2 px-3">
                    {it.kind === "outbound" ? (
                      <>
                        <div className="font-medium text-[#0f172a]">{OP_TYPE[it.instructionType]?.label ?? it.instructionType}</div>
                        <div className="text-[11px] text-[#94A3B8]">Instruction · {it.pspName}</div>
                      </>
                    ) : (
                      <>
                        <div className="font-medium text-[#0f172a]">{PSP_EVENT[it.event] ?? it.event}</div>
                        <div className="text-[11px] text-[#94A3B8]">
                          {PSP_CHANNEL[it.channel] ?? it.channel} · signature {it.signatureValid ? "✓" : "✗"}
                        </div>
                      </>
                    )}
                  </td>
                  <td className="py-2 px-3 max-w-[220px]">
                    {it.pspReference ? (
                      <button
                        onClick={() => setExchange(it.pspReference!)}
                        className="font-mono text-[11px] text-[#008751] hover:underline truncate block max-w-full text-left"
                        title="Voir l'échange complet"
                      >
                        {it.pspReference}
                      </button>
                    ) : (
                      <span className="text-[#94A3B8]">—</span>
                    )}
                  </td>
                  <td className="py-2 px-3 max-w-[220px]">
                    {it.contractId ? (
                      <button onClick={() => onOpenContract(it.contractId!)} className="text-left text-[#475569] hover:text-[#008751] hover:underline truncate block max-w-full">
                        {it.label}
                      </button>
                    ) : (
                      <span className="text-[#94A3B8] truncate block">{it.label}</span>
                    )}
                  </td>
                  <td className="py-2 px-3 text-right tabular-nums whitespace-nowrap">{it.amount !== null ? money(it.amount, it.kind === "outbound" ? it.currency : "XOF") : "—"}</td>
                  <td className="py-2 px-3">
                    {it.kind === "outbound" ? (
                      <Chip tone={OP_STATUS[it.operationStatus]?.tone ?? "slate"}>{OP_STATUS[it.operationStatus]?.label ?? it.operationStatus}</Chip>
                    ) : (
                      <div className="flex flex-col items-start gap-0.5">
                        <Chip tone={PSP_OUTCOME[it.outcome]?.tone ?? "slate"}>{PSP_OUTCOME[it.outcome]?.label ?? it.outcome}</Chip>
                        {it.error && <span className="text-[11px] text-[#B91C1C]">{PSP_ERROR[it.error] ?? it.error}</span>}
                      </div>
                    )}
                  </td>
                  <td className="py-2 px-3 whitespace-nowrap text-[#475569] tabular-nums">
                    {it.kind === "outbound" ? (
                      it.latencyMs !== null ? `dénouée en ${duration(it.latencyMs)}` : <span className="text-[#92400E]">sans réponse</span>
                    ) : (
                      <>
                        {it.latencyMs !== null ? `+${duration(it.latencyMs)}` : "—"}
                        <div className="text-[11px] text-[#94A3B8]">traité en {duration(it.durationMs)}</div>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && !failed && (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-[#94A3B8]">Aucun échange sur cette période avec ces filtres.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-2.5 border-t border-[#F1F5F9] text-[12px] text-[#64748B] flex items-center justify-between gap-3">
          <span>{failed ? "Le journal n'a pas pu être chargé." : `${items.length} échange${items.length > 1 ? "s" : ""} affiché${items.length > 1 ? "s" : ""}`}</span>
          {cursor && (
            <button onClick={() => load(cursor)} disabled={loading} className="h-8 px-3 rounded-lg border border-[#E2E8F0] bg-white font-medium hover:bg-[#F8FAF9] disabled:opacity-50">
              {loading ? "Chargement…" : "Charger plus"}
            </button>
          )}
        </div>
      </div>

      {exchange && (
        <ExchangeDrawer
          reference={exchange}
          onClose={() => setExchange(null)}
          onOpenContract={(id) => {
            setExchange(null);
            onOpenContract(id);
          }}
        />
      )}
    </div>
  );
}
