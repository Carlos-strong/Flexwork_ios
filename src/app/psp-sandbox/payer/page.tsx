"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// Page de paiement Mobile Money SIMULÉE (PSP virtuelle) — reproduit l'écran d'autorisation
// que le client verrait chez le vrai PSP (MTN MoMo / Moov / Orange, style FedaPay). Le client
// « autorise » le prélèvement → la PSP virtuelle renvoie le webhook `hold_confirmed` signé à
// la plateforme, qui fait passer la mission sous séquestre. Jamais active en production.

type OpDetail = {
  id: string;
  pspReference: string | null;
  amount: number;
  currency: string;
  instructionType: string;
  status: string;
  missionId: string | null;
  missionTitre: string | null;
  jalonId: string | null;
};

function PayerInner() {
  const searchParams = useSearchParams();
  const ref = searchParams.get("ref");
  const fallbackAmount = searchParams.get("amount");
  const fallbackCurrency = searchParams.get("currency") ?? "XOF";
  const fallbackMissionId = searchParams.get("missionId");

  const [op, setOp] = useState<OpDetail | null>(null);
  const [mode, setMode] = useState<string>("console");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<"success" | "failed" | null>(null);

  const reload = useCallback(() => {
    if (!ref) return;
    fetch(`/api/psp-virtual/operations?ref=${encodeURIComponent(ref)}`)
      .then(async (r) => {
        if (r.status === 404) {
          // Référence introuvable : probablement déjà confirmée par le mode autoconfirm.
          return { missing: true };
        }
        if (!r.ok) return { missing: true };
        const data = await r.json();
        setMode(data.mode ?? "console");
        setOp(data.operation);
        return null;
      })
      .then((res) => {
        if (res?.missing) {
          setError("Cette référence n&apos;existe pas ou a déjà été traitée par la PSP virtuelle.");
        }
      })
      .catch(() => setError("Impossible de contacter la PSP virtuelle."));
  }, [ref]);

  useEffect(reload, [reload]);

  async function decide(accept: boolean) {
    if (!ref) return;
    setError(null);
    setBusy("deciding");
    const res = await fetch("/api/psp-virtual/operate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: accept ? "authorize" : "fail", pspReference: ref }),
    });
    setBusy(null);
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error === "operation_not_pending" ? "Cette opération a déjà été traitée." : "Échec de l&apos;autorisation du paiement.");
      return;
    }
    setOutcome(accept ? "success" : "failed");
  }

  if (!ref) {
    return (
      <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a] flex items-center justify-center p-4">
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 max-w-md text-center space-y-2">
          <div className="text-[15px] font-semibold">Référence manquante</div>
          <p className="text-[13px] text-[#64748B]">Cette page simule l&apos;autorisation d&apos;un paiement — un paramètre <code className="bg-[#F1F5F9] px-1 rounded">ref</code> est requis.</p>
        </div>
      </div>
    );
  }

  if (error && !op) {
    return (
      <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a] flex items-center justify-center p-4">
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-5 max-w-md text-center space-y-2">
          <div className="text-[15px] font-semibold">Paiement introuvable</div>
          <p className="text-[13px] text-[#64748B]">{error}</p>
          <Link href="/psp-sandbox" className="inline-block text-[12.5px] text-[#008751] font-medium" style={{ textDecoration: "none" }}>Retour à la console PSP</Link>
        </div>
      </div>
    );
  }

  if (!op) {
    return <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a] flex items-center justify-center text-[13px] text-[#64748B]">Chargement du paiement…</div>;
  }

  const amount = op.amount ?? Number(fallbackAmount ?? 0);
  const currency = op.currency ?? fallbackCurrency;
  const missionId = op.missionId ?? fallbackMissionId;
  const alreadyProcessed = op.status !== "pending";

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[420px] space-y-4">
        <div className="text-center space-y-1">
          <div className="text-[11px] uppercase tracking-widest text-[#64748B] font-semibold">Paiement sécurisé — PSP virtuelle</div>
          <div className="text-[13px] text-[#64748B]">Environnement de simulation (développement)</div>
        </div>

        <div className="bg-white border border-[#E2E8F0] rounded-2xl p-6 space-y-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-[13px] text-[#64748B]">Marchand</div>
            <div className="text-[13px] font-semibold">Flexwork — Séquestre</div>
          </div>

          <div className="rounded-xl bg-[#0f172a] text-white p-4 text-center">
            <div className="text-[11px] uppercase tracking-wider text-[#94A3B8]">Montant à payer</div>
            <div className="text-[26px] font-bold mt-1">{amount.toLocaleString("fr-FR")} <span className="text-[15px]">{currency}</span></div>
            {op.missionTitre && <div className="text-[11.5px] text-[#94A3B8] mt-1">{op.missionTitre}</div>}
          </div>

          <div className="space-y-2 text-[12.5px]">
            <div className="flex justify-between"><span className="text-[#64748B]">Référence PSP</span><span className="font-medium break-all text-right pl-3">{op.pspReference}</span></div>
            <div className="flex justify-between"><span className="text-[#64748B]">Moyen de paiement</span><span className="font-medium">Mobile Money (MTN · Moov · Orange)</span></div>
            <div className="flex justify-between"><span className="text-[#64748B]">Statut</span><span className="font-medium">{alreadyProcessed ? "Déjà traité" : "En attente d&apos;autorisation"}</span></div>
          </div>

          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[12.5px] text-[#B91C1C]">{error}</div>}

          {outcome === "success" && (
            <div className="rounded-xl border border-[#BBF7D0] bg-[#F0FDF4] p-3 text-[12.5px] text-[#166534]">
              <strong>Paiement autorisé.</strong> La PSP virtuelle a confirmé le HOLD — les fonds sont sous séquestre.
            </div>
          )}
          {outcome === "failed" && (
            <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[12.5px] text-[#B91C1C]">
              <strong>Paiement refusé.</strong> L&apos;opération a été marquée comme échouée.
            </div>
          )}

          {!alreadyProcessed && !outcome && (
            <div className="space-y-2">
              <button
                disabled={busy !== null}
                onClick={() => decide(true)}
                className="w-full h-11 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] disabled:opacity-50"
              >
                {busy === "deciding" ? "Traitement…" : "Autoriser le paiement"}
              </button>
              <button
                disabled={busy !== null}
                onClick={() => decide(false)}
                className="w-full h-11 rounded-lg border border-[#E2E8F0] bg-white text-[13px] font-medium hover:bg-[#F8FAF9] disabled:opacity-50"
              >
                Refuser
              </button>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <Link href="/psp-sandbox" className="text-[12px] text-[#64748B] hover:text-[#0f172a]" style={{ textDecoration: "none" }}>← Console PSP</Link>
            {missionId ? (
              <Link href={`/missions/${missionId}/escrow`} className="text-[12px] text-[#008751] font-medium" style={{ textDecoration: "none" }}>Revenir à la mission ↗</Link>
            ) : (
              <span className="text-[12px] text-[#94A3B8]">{mode === "autoconfirm" ? "Mode autoconfirm actif" : ""}</span>
            )}
          </div>
        </div>

        <p className="text-[11px] text-[#94A3B8] text-center leading-relaxed">
          Aucun argent réel n&apos;est en jeu. Cette page simule l&apos;écran du PSP agréé pour tester le cycle séquestre
          (HOLD → autorisation → webhook signé → fonds sous séquestre) sans intégration réelle.
        </p>
      </div>
    </div>
  );
}

export default function PayerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F8FAF9] text-[#0f172a] flex items-center justify-center text-[13px] text-[#64748B]">Chargement…</div>}>
      <PayerInner />
    </Suspense>
  );
}
