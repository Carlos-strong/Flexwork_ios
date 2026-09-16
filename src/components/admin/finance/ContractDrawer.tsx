"use client";

import { useCallback, useEffect, useState } from "react";
import type { ContractFinanceDetail } from "@/lib/admin-finance";
import { ACTION_ERROR, ANOMALY, Chip, FIN_STATE, MISSION_STATUS, OP_STATUS, OP_TYPE, PAYABLE_STATUS, SEVERITY, dateTime, inputCls, money } from "./ui";

type Detail = ContractFinanceDetail & { viewerRole: string | null };

// Fiche financière d'un contrat — tout ce qu'il faut pour comprendre où est l'argent, et les deux
// gestes qui peuvent le faire sortir. Chaque geste annonce son montant avant confirmation et
// exige une justification, journalisée côté serveur.
export function ContractDrawer({
  contractId,
  onClose,
  onChanged,
  notify,
}: {
  contractId: string;
  onClose: () => void;
  onChanged: () => void;
  notify: (message: string) => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [retentionReason, setRetentionReason] = useState("");
  const [busy, setBusy] = useState<null | "refund" | "retention">(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/finance/contracts/${contractId}`, { cache: "no-store" });
    if (!res.ok) {
      setLoadError(res.status === 404 ? "Contrat introuvable." : "La fiche n'a pas pu être chargée.");
      return;
    }
    setDetail(await res.json());
    setLoadError(null);
  }, [contractId]);

  useEffect(() => {
    setDetail(null);
    load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function act(kind: "refund" | "retention") {
    setActionError(null);
    setBusy(kind);
    const url =
      kind === "refund"
        ? `/api/admin/contracts/${contractId}/refund`
        : `/api/admin/contracts/${contractId}/retention/settle`;
    const body =
      kind === "refund"
        ? { justification: refundReason, ...(refundAmount ? { amount: Math.round(Number(refundAmount)) } : {}) }
        : { justification: retentionReason };
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) {
      setActionError(ACTION_ERROR[data.error] ?? `Échec : ${data.error ?? res.status}`);
      return;
    }
    notify(
      kind === "refund"
        ? `Remboursement de ${money(data.amount)} instruit — en attente de confirmation PSP.`
        : `Retenue de ${money(data.amount)} instruite — en attente de confirmation PSP.`
    );
    setRefundAmount("");
    setRefundReason("");
    setRetentionReason("");
    await load();
    onChanged();
  }

  const d = detail;
  const b = d?.row.balance;
  const canAct = d?.viewerRole === "mediation";

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Fiche financière du contrat">
      <div className="absolute inset-0 bg-[#0f172a]/40" onClick={onClose} />
      <div className="relative w-full max-w-[620px] h-full bg-[#F8FAF9] overflow-y-auto shadow-2xl">
        <div className="sticky top-0 z-10 bg-white border-b border-[#E2E8F0] px-4 lg:px-5 py-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[11px] text-[#94A3B8] font-mono">Contrat {contractId.slice(0, 10)}</div>
            <h2 className="text-[15px] font-bold text-[#0f172a] truncate">{d?.row.titre ?? "Chargement…"}</h2>
            {d && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <Chip tone={FIN_STATE[d.row.financialState]?.tone ?? "slate"}>{FIN_STATE[d.row.financialState]?.label}</Chip>
                <Chip tone="slate">{MISSION_STATUS[d.row.missionStatus] ?? d.row.missionStatus}</Chip>
                {d.row.financingModeKey && <Chip tone="slate">Mode {d.row.financingModeKey}</Chip>}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 h-8 w-8 rounded-lg border border-[#E2E8F0] bg-white text-[#475569] hover:bg-[#F1F5F9]"
            aria-label="Fermer"
          >
            ✕
          </button>
        </div>

        {loadError && <p className="m-4 rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C]">{loadError}</p>}

        {d && b && (
          <div className="p-4 lg:p-5 space-y-4">
            {/* Parties */}
            <div className="grid grid-cols-2 gap-2 text-[12px]">
              {[
                ["Client", d.row.client],
                ["Prestataire", d.row.provider],
              ].map(([role, p]) => {
                const party = p as Detail["row"]["client"];
                return (
                  <div key={role as string} className="rounded-xl border border-[#E2E8F0] bg-white p-2.5 min-w-0">
                    <div className="text-[10px] uppercase tracking-widest text-[#94A3B8] font-semibold">{role as string}</div>
                    <div className="font-semibold text-[#0f172a] truncate">{party.name}</div>
                    <div className="text-[#64748B] truncate">{party.email ?? "—"}</div>
                  </div>
                );
              })}
            </div>

            {/* Compte du séquestre */}
            <section className="rounded-xl border border-[#E2E8F0] bg-white p-3.5">
              <div className="flex items-center justify-between gap-2 mb-2">
                <h3 className="text-[13px] font-semibold">Compte du séquestre</h3>
                <span className="text-[11.5px] text-[#64748B] tabular-nums">Prix du contrat {money(d.price, d.row.currency)}</span>
              </div>
              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-[12px]">
                {(
                  [
                    ["Financé", b.funded, ""],
                    ["Versé au prestataire", b.released, "text-[#008751]"],
                    ["Remboursé au client", b.refunded, ""],
                    ["Détenu", b.held, "font-bold"],
                    ["Gelé", b.blocked, b.blocked > 0 ? "text-[#B91C1C]" : ""],
                    ["Retenu", b.retained, b.retained > 0 ? "text-[#92400E]" : ""],
                    ["Dû au prestataire", b.owedToProvider, ""],
                    ["Restituable au client", b.refundable, ""],
                    ["Dû non couvert", d.row.missing, d.row.missing > 0 ? "text-[#92400E]" : ""],
                  ] as const
                ).map(([label, value, cls]) => (
                  <div key={label}>
                    <dt className="text-[#64748B]">{label}</dt>
                    <dd className={`tabular-nums text-[#0f172a] ${cls}`}>{money(value, d.row.currency)}</dd>
                  </div>
                ))}
              </dl>
              <div
                className={`mt-3 rounded-lg px-3 py-2 text-[12px] ${
                  d.row.violations.length === 0 ? "bg-[#E6F4EE] text-[#00623A]" : "bg-[#FEF2F2] text-[#B91C1C]"
                }`}
              >
                {d.row.violations.length === 0 ? (
                  "Règles d'or respectées : financé = versé + remboursé + détenu, et rien de gelé ou retenu n'est disponible."
                ) : (
                  <ul className="space-y-0.5">
                    {d.row.violations.map((v, i) => (
                      <li key={i}>
                        <strong>{v.rule === "accounting" ? "Identité comptable" : v.rule === "rule1" ? "Règle 1" : "Règle 2"}</strong> — {v.detail}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            {/* Anomalies */}
            {d.anomalies.length > 0 && (
              <section className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5 space-y-2">
                <h3 className="text-[13px] font-semibold text-[#92400E]">À traiter ({d.anomalies.length})</h3>
                {d.anomalies.map((a) => (
                  <div key={a.id} className="text-[12px] text-[#78350F]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Chip tone={SEVERITY[a.severity].tone}>{SEVERITY[a.severity].label}</Chip>
                      <strong>{ANOMALY[a.kind]?.label}</strong>
                      {a.amount > 0 && <span className="tabular-nums">· {money(a.amount, d.row.currency)}</span>}
                    </div>
                    <p className="mt-0.5">{a.detail}</p>
                    <p className="text-[11.5px] opacity-80">→ {ANOMALY[a.kind]?.action}</p>
                  </div>
                ))}
              </section>
            )}

            {/* Gestes */}
            <section className="rounded-xl border border-[#E2E8F0] bg-white p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-semibold">Gestes administratifs</h3>
                {!canAct && <Chip tone="slate">Lecture seule — rôle Médiation requis</Chip>}
              </div>

              <div className="rounded-lg border border-[#E2E8F0] p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <strong className="text-[12.5px]">Rembourser le reliquat au client</strong>
                  <span className="text-[12px] text-[#64748B] tabular-nums">Disponible : {money(d.actions.refund.amount, d.row.currency)}</span>
                </div>
                <p className="text-[11.5px] text-[#64748B]">
                  Borné par le disponible : ni le gelé, ni la retenue ne partent. À réserver aux missions qui ne produiront plus aucun versement.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2">
                  <input
                    id="refund-amount"
                    type="number"
                    min={1}
                    step={500}
                    value={refundAmount}
                    onChange={(e) => setRefundAmount(e.target.value)}
                    placeholder="Tout"
                    aria-label="Montant à rembourser (vide = tout le disponible)"
                    className={`${inputCls} tabular-nums`}
                    disabled={!canAct || !d.actions.refund.available}
                  />
                  <input
                    id="refund-justification"
                    type="text"
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    placeholder="Justification (journalisée)"
                    aria-label="Justification du remboursement"
                    className={inputCls}
                    disabled={!canAct || !d.actions.refund.available}
                  />
                </div>
                <button
                  onClick={() => act("refund")}
                  disabled={!canAct || !d.actions.refund.available || refundReason.trim().length < 5 || busy !== null}
                  className="h-9 px-4 rounded-lg bg-[#0f172a] text-white text-[12.5px] font-semibold hover:bg-black disabled:opacity-40"
                >
                  {busy === "refund"
                    ? "Instruction…"
                    : `Rembourser ${money(refundAmount ? Math.min(Number(refundAmount), d.actions.refund.amount) : d.actions.refund.amount, d.row.currency)}`}
                </button>
              </div>

              <div className="rounded-lg border border-[#E2E8F0] p-3 space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <strong className="text-[12.5px]">Solder la retenue au prestataire</strong>
                  <span className="text-[12px] text-[#64748B] tabular-nums">Retenue : {money(d.actions.retention.amount, d.row.currency)}</span>
                </div>
                {d.actions.retention.reason ? (
                  <p className="text-[11.5px] text-[#64748B]">{d.actions.retention.reason}</p>
                ) : (
                  <>
                    <input
                      id="retention-justification"
                      type="text"
                      value={retentionReason}
                      onChange={(e) => setRetentionReason(e.target.value)}
                      placeholder="Justification (journalisée)"
                      aria-label="Justification du solde de retenue"
                      className={inputCls}
                      disabled={!canAct}
                    />
                    <button
                      onClick={() => act("retention")}
                      disabled={!canAct || retentionReason.trim().length < 5 || busy !== null}
                      className="h-9 px-4 rounded-lg bg-[#008751] text-white text-[12.5px] font-semibold hover:bg-[#007a49] disabled:opacity-40"
                    >
                      {busy === "retention" ? "Instruction…" : "Solder la retenue"}
                    </button>
                  </>
                )}
              </div>

              {actionError && (
                <p className="rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[12px] text-[#B91C1C]" role="alert">
                  {actionError}
                </p>
              )}
            </section>

            {/* Registre du contrat */}
            <section className="rounded-xl border border-[#E2E8F0] bg-white">
              <h3 className="text-[13px] font-semibold px-3.5 pt-3">Registre PSP ({d.operations.length})</h3>
              <ul className="divide-y divide-[#F1F5F9] mt-2">
                {d.operations.map((op) => {
                  const t = OP_TYPE[op.instructionType];
                  return (
                    <li key={op.id} className="px-3.5 py-2 flex items-start justify-between gap-3 text-[12px]">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Chip tone={t?.tone ?? "slate"}>{t?.label ?? op.instructionType}</Chip>
                          <Chip tone={OP_STATUS[op.status]?.tone ?? "slate"}>{OP_STATUS[op.status]?.label ?? op.status}</Chip>
                          {op.jalon && <span className="text-[#64748B] truncate">{op.jalon}</span>}
                        </div>
                        <div className="text-[11px] text-[#94A3B8] mt-0.5 font-mono truncate">
                          {dateTime(op.instructionSentAt)} · {op.pspReference ?? "sans référence"}
                        </div>
                      </div>
                      <strong
                        className={`tabular-nums shrink-0 ${t?.sign === 1 ? "text-[#1E40AF]" : t?.sign === -1 ? "text-[#0f172a]" : "text-[#94A3B8]"}`}
                      >
                        {t?.sign === 1 ? "+" : t?.sign === -1 ? "−" : ""}
                        {money(op.amount, op.currency)}
                      </strong>
                    </li>
                  );
                })}
                {d.operations.length === 0 && <li className="px-3.5 py-3 text-[12px] text-[#94A3B8]">Aucun mouvement.</li>}
              </ul>
            </section>

            {/* Créances */}
            {d.payables.length > 0 && (
              <section className="rounded-xl border border-[#E2E8F0] bg-white">
                <h3 className="text-[13px] font-semibold px-3.5 pt-3">Créances ({d.payables.length})</h3>
                <ul className="divide-y divide-[#F1F5F9] mt-2">
                  {d.payables.map((p) => (
                    <li key={p.id} className="px-3.5 py-2 flex items-center justify-between gap-3 text-[12px]">
                      <div className="min-w-0">
                        <div className="truncate text-[#0f172a]">{p.label}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <Chip tone={PAYABLE_STATUS[p.status]?.tone ?? "slate"}>{PAYABLE_STATUS[p.status]?.label ?? p.status}</Chip>
                          <span className="text-[11px] text-[#94A3B8]">{dateTime(p.paidAt ?? p.validatedAt)}</span>
                        </div>
                      </div>
                      <strong className="tabular-nums shrink-0">{money(p.amount, p.currency)}</strong>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {/* Structure du contrat */}
            {(d.jalons.length > 0 || d.timeTerms) && (
              <section className="rounded-xl border border-[#E2E8F0] bg-white p-3.5 text-[12px] space-y-1.5">
                <h3 className="text-[13px] font-semibold">Structure</h3>
                {d.timeTerms && (
                  <p className="text-[#475569] tabular-nums">
                    Au temps : {money(d.timeTerms.rate, d.row.currency)} / {d.timeTerms.rateUnit} × {d.timeTerms.maxQuantity} — plafond{" "}
                    {money(d.timeTerms.maxAmount, d.row.currency)}. Relevés :{" "}
                    {Object.entries(d.attendance).map(([s, n]) => `${n} ${s}`).join(", ") || "aucun"}.
                  </p>
                )}
                {d.jalons.map((j) => (
                  <div key={j.ordre} className="flex items-center justify-between gap-3">
                    <span className="truncate text-[#475569]">
                      #{j.ordre} {j.titre}
                    </span>
                    <span className="flex items-center gap-2 shrink-0">
                      <Chip tone={j.status === "libere" ? "green" : j.status === "rejete" ? "red" : "slate"}>{j.status}</Chip>
                      <span className="tabular-nums">{money(j.montant, d.row.currency)}</span>
                    </span>
                  </div>
                ))}
                {d.row.retentionRate > 0 && <p className="text-[#92400E]">Retenue de garantie : {Math.round(d.row.retentionRate * 100)} % par jalon.</p>}
              </section>
            )}

            {/* Médiations */}
            {d.mediations.length > 0 && (
              <section className="rounded-xl border border-[#E2E8F0] bg-white p-3.5 text-[12px] space-y-2">
                <h3 className="text-[13px] font-semibold">Médiations</h3>
                {d.mediations.map((m) => (
                  <div key={m.id} className="border-t border-[#F1F5F9] pt-2 first:border-0 first:pt-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Chip tone={m.outcome === "en_cours" ? "amber" : m.outcome === "agreement" ? "green" : "slate"}>{m.outcome}</Chip>
                      <span className="text-[#94A3B8]">{dateTime(m.createdAt)}</span>
                    </div>
                    <p className="text-[#475569] mt-0.5">{m.reason}</p>
                    {(m.resolutionAmount || m.refundAmount) && (
                      <p className="text-[#64748B] tabular-nums">
                        Proposé : {money(m.resolutionAmount ?? 0)} au prestataire · {money(m.refundAmount ?? 0)} au client
                      </p>
                    )}
                  </div>
                ))}
              </section>
            )}

            {/* Journal */}
            <section className="rounded-xl border border-[#E2E8F0] bg-white p-3.5 text-[12px]">
              <h3 className="text-[13px] font-semibold mb-1.5">Gestes admin sur ce contrat</h3>
              {d.adminLogs.length === 0 ? (
                <p className="text-[#94A3B8]">Aucun geste enregistré.</p>
              ) : (
                <ul className="space-y-1.5">
                  {d.adminLogs.map((l) => (
                    <li key={l.id}>
                      <span className="text-[#94A3B8]">{dateTime(l.createdAt)}</span> · <strong>{l.action}</strong> par {l.adminEmail ?? "—"}
                      <div className="text-[#475569]">{l.justification}</div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
