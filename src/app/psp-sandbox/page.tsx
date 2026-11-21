"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

// Console de la PSP virtuelle (sandbox de développement) — simule l'écran opérateur du
// prestataire de paiement agréé. Permet de traiter les opérations `pending` (autoriser un
// paiement Mobile Money, confirmer une libération/gel/remboursement, ou faire échouer) en
// renvoyant un webhook signé vers la plateforme. Jamais active en production (les routes
// API renvoient 404, la page affiche alors un simple avertissement).

type HeldView = { contractId: string; missionId: string | null; missionTitre: string | null; amount: number; currency: string };
type OpView = {
  id: string;
  pspReference: string | null;
  amount: number;
  currency: string;
  instructionType: string;
  status: string;
  instructionSentAt: string;
  pspConfirmedAt: string | null;
  contractId: string;
  missionId: string | null;
  missionTitre: string | null;
  jalonId: string | null;
};
type Snapshot = { enabled: boolean; mode: "console" | "autoconfirm"; pspName: string; operations: OpView[]; held: HeldView[] };

const TYPE_LABEL: Record<string, string> = {
  hold: "Mise sous séquestre (HOLD)",
  release: "Libération (RELEASE)",
  retention_release: "Libération de la retenue de garantie",
  freeze: "Gel (FREEZE)",
  refund: "Remboursement (REFUND)",
};
// Action d'opérateur qui confirme chaque type d'instruction. Table plutôt que cascade de
// ternaires : un type ajouté au schéma se voit ici, et la ligne manquante saute aux yeux.
const ACTION_FOR_TYPE: Record<string, string> = {
  hold: "authorize",
  release: "release",
  retention_release: "release",
  freeze: "freeze",
  refund: "refund",
};
const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  pending: { label: "En attente", cls: "bg-[#FFF6E3] text-[#92400E]" },
  confirmed: { label: "Confirmé", cls: "bg-[#E7F7EF] text-[#047857]" },
  failed: { label: "Échoué", cls: "bg-[#FEECEB] text-[#B42318]" },
};
const ACTION_LABEL: Record<string, string> = {
  authorize: "Autoriser le paiement",
  release: "Confirmer la libération",
  freeze: "Confirmer le gel",
  refund: "Confirmer le remboursement",
  fail: "Faire échouer",
};

export default function PspSandboxPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyRef, setBusyRef] = useState<string | null>(null);

  const reload = useCallback(() => {
    fetch("/api/psp-virtual/operations")
      .then(async (r) => {
        // Hors développement, la route API renvoie 404 → la console est « indisponible »
        // plutôt que de rester bloquée sur « Chargement… ».
        if (!r.ok) return { enabled: false, mode: "console", pspName: "", operations: [], held: [] };
        return r.json();
      })
      .then(setSnapshot)
      .catch(() => setError("Impossible de charger l'état de la PSP virtuelle."));
  }, []);

  useEffect(reload, [reload]);

  async function operate(pspReference: string, action: string) {
    setError(null);
    setBusyRef(pspReference);
    const res = await fetch("/api/psp-virtual/operate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, pspReference }),
    });
    setBusyRef(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "operation_not_pending" ? "Cette opération a déjà été traitée." : "Échec de l'action sur la PSP virtuelle.");
      return;
    }
    reload();
  }

  if (error && !snapshot) {
    return (
      <div className="min-h-screen bg-[#F6F5FA] text-[#191224] flex items-center justify-center p-4">
        <div className="bg-white border border-[#FECACA] rounded-xl p-5 max-w-md text-[13px] text-[#B42318]">{error}</div>
      </div>
    );
  }
  if (!snapshot) {
    return <div className="min-h-screen bg-[#F6F5FA] text-[#191224] flex items-center justify-center text-[13px] text-[#6B6478]">Chargement...</div>;
  }
  if (!snapshot.enabled) {
    return (
      <div className="min-h-screen bg-[#F6F5FA] text-[#191224] flex items-center justify-center p-4">
        <div className="bg-white border border-[#E7E2F0] rounded-xl p-5 max-w-md text-center space-y-2">
          <div className="text-[15px] font-semibold">Console PSP indisponible</div>
          <p className="text-[13px] text-[#6B6478]">
            La PSP virtuelle n&apos;est active qu&apos;en développement (NEXT_PUBLIC_APP_ENV ≠ production). En production, seules les confirmations du vrai PSP sont acceptées.
          </p>
        </div>
      </div>
    );
  }

  const pendingOps = snapshot.operations.filter((o) => o.status === "pending");
  const actionFor = (o: OpView): string | null =>
    ACTION_FOR_TYPE[o.instructionType] ?? null;

  return (
    <div className="min-h-screen bg-[#F6F5FA] text-[#191224]">
      <div className="fluid-doc [--fw:900px] mx-auto px-4 py-6 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-[16px] font-bold">PSP virtuelle — console sandbox</h1>
            <p className="text-[12px] text-[#6B6478]">
              Simulation du prestataire de paiement agréé. Envoie des webhooks signés HMAC vers <code className="bg-[#EFEAF8] px-1 rounded">/api/webhooks/psp</code>.
            </p>
          </div>
          <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-semibold ${snapshot.mode === "autoconfirm" ? "bg-[#FFF6E3] text-[#92400E]" : "bg-[#E7F7EF] text-[#047857]"}`}>
            {snapshot.mode === "autoconfirm" ? "Mode autoconfirm (ESCROW_STUB_AUTOCONFIRM=true)" : "Mode console (actions manuelles)"}
          </span>
        </div>

        {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEECEB] p-3 text-[13px] text-[#B42318]">{error}</div>}

        <div className="rounded-xl border border-[#BFDBFE] bg-[#EAF1FF] p-3 text-[12.5px] text-[#1D4ED8] leading-relaxed">
          <strong>Outil de développement uniquement.</strong> Les confirmations passent par le même chemin sécurisé qu&apos;un vrai PSP
          (signature HMAC vérifiée). En production cette console n&apos;existe pas : seul le webhook du PSP réel confirme un mouvement (US-503).
        </div>

        <div className="bg-white border border-[#E7E2F0] rounded-xl p-4 lg:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-semibold">Fonds séquestrés par contrat (détenus par la PSP)</h2>
            <Link href="/psp-sandbox/payer" className="text-[12px] text-[#047857] font-medium" style={{ textDecoration: "none" }}>Page paiement simulée ↗</Link>
          </div>
          {snapshot.held.length === 0 ? (
            <p className="text-[13px] text-[#9A93A8]">Aucun fonds sous séquestre confirmé pour l&apos;instant.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="text-left text-[#6B6478] border-b border-[#EFEAF8]">
                    <th className="py-2 pr-3 font-medium">Mission</th>
                    <th className="py-2 pr-3 font-medium">Contrat</th>
                    <th className="py-2 pr-3 font-medium text-right">Montant séquestré</th>
                    <th className="py-2 font-medium">Devise</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.held.map((h) => (
                    <tr key={h.contractId} className="border-b border-[#F6F5FA]">
                      <td className="py-2 pr-3">{h.missionTitre ?? "—"}</td>
                      <td className="py-2 pr-3 text-[#6B6478]">{h.contractId.slice(0, 12)}…</td>
                      <td className="py-2 pr-3 text-right font-semibold text-[#047857]">{h.amount.toLocaleString("fr-FR")}</td>
                      <td className="py-2">{h.currency}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="bg-white border border-[#E7E2F0] rounded-xl p-4 lg:p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-[13px] font-semibold">Opérations récentes</h2>
            <span className="text-[11px] text-[#6B6478]">{pendingOps.length} en attente de traitement</span>
          </div>
          {snapshot.operations.length === 0 ? (
            <p className="text-[13px] text-[#9A93A8]">Aucune instruction reçue par la PSP pour le moment.</p>
          ) : (
            <div className="space-y-2">
              {snapshot.operations.map((op) => {
                const st = STATUS_LABEL[op.status] ?? { label: op.status, cls: "bg-[#EFEAF8] text-[#4A4258]" };
                const action = actionFor(op);
                return (
                  <div key={op.id} className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-[#EFEAF8] p-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12.5px] font-semibold">{TYPE_LABEL[op.instructionType] ?? op.instructionType}</span>
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold ${st.cls}`}>{st.label}</span>
                        {op.jalonId && <span className="text-[10.5px] text-[#6B6478]">Jalon</span>}
                      </div>
                      <div className="text-[11.5px] text-[#6B6478] truncate">
                        {op.missionTitre ?? "Mission inconnue"} · {op.pspReference} · {new Date(op.instructionSentAt).toLocaleString("fr-FR")}
                        {op.pspConfirmedAt ? ` · confirmé ${new Date(op.pspConfirmedAt).toLocaleString("fr-FR")}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[13px] font-bold text-[#047857]">{op.amount.toLocaleString("fr-FR")} {op.currency}</span>
                      {op.status === "pending" && action && (
                        <button
                          disabled={busyRef === op.pspReference}
                          onClick={() => op.pspReference && operate(op.pspReference, action)}
                          className="h-8 px-3 rounded-full bg-[#4C1D95] text-white text-[11.5px] font-semibold hover:bg-[#3B1578] disabled:opacity-50"
                        >
                          {ACTION_LABEL[action]}
                        </button>
                      )}
                      {op.status === "pending" && (
                        <button
                          disabled={busyRef === op.pspReference}
                          onClick={() => op.pspReference && operate(op.pspReference, "fail")}
                          className="h-8 px-3 rounded-md border border-[#FECACA] bg-white text-[#B42318] text-[11.5px] font-medium hover:bg-[#FEECEB] disabled:opacity-50"
                        >
                          Faire échouer
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
    </div>
  );
}
