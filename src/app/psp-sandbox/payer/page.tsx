"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// Page de paiement Mobile Money SIMULÉE (PSP virtuelle) — reproduit l'écran d'autorisation
// que le client verrait chez le vrai PSP (MTN MoMo / Moov Money / Celtiis Cash, style FedaPay). Le client
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
      <div className="min-h-screen bg-[#F6F5FA] text-[#191224] flex items-center justify-center p-4">
        <div className="bg-white border border-[#E7E2F0] rounded-xl p-5 max-w-md text-center space-y-2">
          <div className="text-[15px] font-semibold">Référence manquante</div>
          <p className="text-[13px] text-[#6B6478]">Cette page simule l&apos;autorisation d&apos;un paiement — un paramètre <code className="bg-[#EFEAF8] px-1 rounded">ref</code> est requis.</p>
        </div>
      </div>
    );
  }

  if (error && !op) {
    return (
      <div className="min-h-screen bg-[#F6F5FA] text-[#191224] flex items-center justify-center p-4">
        <div className="bg-white border border-[#E7E2F0] rounded-xl p-5 max-w-md text-center space-y-2">
          <div className="text-[15px] font-semibold">Paiement introuvable</div>
          <p className="text-[13px] text-[#6B6478]">{error}</p>
          <Link href="/psp-sandbox" className="inline-block text-[12.5px] text-[#4C1D95] font-medium" style={{ textDecoration: "none" }}>Retour à la console PSP</Link>
        </div>
      </div>
    );
  }

  if (!op) {
    return <div className="min-h-screen bg-[#F6F5FA] text-[#191224] flex items-center justify-center text-[13px] text-[#6B6478]">Chargement du paiement…</div>;
  }

  const amount = op.amount ?? Number(fallbackAmount ?? 0);
  const currency = op.currency ?? fallbackCurrency;
  const missionId = op.missionId ?? fallbackMissionId;
  const alreadyProcessed = op.status !== "pending";

  return (
    <div className="min-h-screen bg-[#F6F5FA] text-[#191224] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[420px] space-y-4">
        <div className="text-center space-y-1">
          <div className="text-[11px] uppercase tracking-widest text-[#6B6478] font-semibold">Paiement sécurisé — PSP virtuelle</div>
          <div className="text-[13px] text-[#6B6478]">Environnement de simulation (développement)</div>
        </div>

        <div className="bg-white border border-[#E7E2F0] rounded-2xl p-6 space-y-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-[13px] text-[#6B6478]">Marchand</div>
            <div className="text-[13px] font-semibold">Flexwork — Séquestre</div>
          </div>

          <div className="rounded-xl bg-[#191224] text-white p-4 text-center">
            <div className="text-[11px] uppercase tracking-wider text-[#9A93A8]">Montant à payer</div>
            <div className="text-[26px] font-bold mt-1">{amount.toLocaleString("fr-FR")} <span className="text-[15px]">{currency}</span></div>
            {op.missionTitre && <div className="text-[11.5px] text-[#9A93A8] mt-1">{op.missionTitre}</div>}
          </div>

          <div className="space-y-2 text-[12.5px]">
            <div className="flex justify-between"><span className="text-[#6B6478]">Référence PSP</span><span className="font-medium break-all text-right pl-3">{op.pspReference}</span></div>
            <div className="flex justify-between"><span className="text-[#6B6478]">Moyen de paiement</span><span className="font-medium">Mobile Money (MTN · Moov · Celtiis)</span></div>
            <div className="flex justify-between"><span className="text-[#6B6478]">Statut</span><span className="font-medium">{alreadyProcessed ? "Déjà traité" : "En attente d&apos;autorisation"}</span></div>
          </div>

          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEECEB] p-3 text-[12.5px] text-[#B42318]">{error}</div>}

          {outcome === "success" && (
            <div className="rounded-xl border border-[#BBF7D0] bg-[#E7F7EF] p-3 text-[12.5px] text-[#047857]">
              <strong>Paiement autorisé.</strong> La PSP virtuelle a confirmé le HOLD — les fonds sont sous séquestre.
            </div>
          )}
          {outcome === "failed" && (
            <div className="rounded-xl border border-[#FECACA] bg-[#FEECEB] p-3 text-[12.5px] text-[#B42318]">
              <strong>Paiement refusé.</strong> L&apos;opération a été marquée comme échouée.
            </div>
          )}

          {!alreadyProcessed && !outcome && (
            <div className="space-y-2">
              <button
                disabled={busy !== null}
                onClick={() => decide(true)}
                className="w-full h-11 rounded-lg bg-[#4C1D95] text-white text-[13px] font-semibold hover:bg-[#3B1578] disabled:opacity-50"
              >
                {busy === "deciding" ? "Traitement…" : "Autoriser le paiement"}
              </button>
              <button
                disabled={busy !== null}
                onClick={() => decide(false)}
                className="w-full h-11 rounded-lg border border-[#E7E2F0] bg-white text-[13px] font-medium hover:bg-[#F6F5FA] disabled:opacity-50"
              >
                Refuser
              </button>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <Link href="/psp-sandbox" className="text-[12px] text-[#6B6478] hover:text-[#191224]" style={{ textDecoration: "none" }}>← Console PSP</Link>
            {missionId ? (
              <Link href={`/missions/${missionId}/escrow`} className="text-[12px] text-[#047857] font-medium" style={{ textDecoration: "none" }}>Revenir à la mission ↗</Link>
            ) : (
              <span className="text-[12px] text-[#9A93A8]">{mode === "autoconfirm" ? "Mode autoconfirm actif" : ""}</span>
            )}
          </div>
        </div>

        <p className="text-[11px] text-[#9A93A8] text-center leading-relaxed">
          Aucun argent réel n&apos;est en jeu. Cette page simule l&apos;écran du PSP agréé pour tester le cycle séquestre
          (HOLD → autorisation → webhook signé → fonds sous séquestre) sans intégration réelle.
        </p>
      </div>
    </div>
  );
}

export default function PayerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#F6F5FA] text-[#191224] flex items-center justify-center text-[13px] text-[#6B6478]">Chargement…</div>}>
      <PayerInner />
    </Suspense>
  );
}
