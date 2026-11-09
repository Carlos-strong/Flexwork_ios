"use client";

// Écran P8 — KYC financier : compte de versement Mobile Money.
//
// ── Pourquoi cet écran existe ───────────────────────────────────────────────────────────
//
// Le schéma ne prévoyait AUCUN moyen d'être payé : ni IBAN, ni Mobile Money. Un prestataire
// pouvait signer, exécuter, voir son séquestre validé — et la plateforme n'avait nulle part où
// envoyer l'argent. L'arbitrage est explicite : pas d'IBAN, les versements passent par PSP
// Mobile Money.
//
// ── Ce qui est demandé, et ce qui ne l'est pas ──────────────────────────────────────────
//
// La PIÈCE D'IDENTITÉ n'est pas redemandée : elle a déjà été téléversée au KYC, cet écran
// n'affiche que son état. Ce qui est propre au dossier financier, c'est le compte de versement
// et le JUSTIFICATIF DE DOMICILE — parce que c'est là que va l'argent.
//
// Le titulaire est SAISI, jamais déduit du compte connecté : un prestataire peut être payé sur
// le compte d'un tiers, et cette différence est exactement ce que l'Admin KYC doit voir.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { MOBILE_MONEY_OPERATORS, PAYOUT_STATUS_LABELS } from "@/lib/mobile-money";

type PayoutState = {
  status: "non_renseigne" | "en_attente" | "verifie" | "rejete";
  operator: string | null;
  number: string | null;
  holder: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  refusalReason: string | null;
  identityReady: boolean;
  identityDocsCount: number;
  identityDocsExpected: number;
  addressProof: { id: string; status: string } | null;
  ready: boolean;
};

const STATUS_CLASSES: Record<string, string> = {
  non_renseigne: "bg-zinc-100 text-zinc-600",
  en_attente: "bg-amber-100 text-amber-800",
  verifie: "bg-[#008751]/10 text-[#008751]",
  rejete: "bg-red-100 text-red-700",
};

export function FinancialKycForm() {
  const [state, setState] = useState<PayoutState | null>(null);
  const [loading, setLoading] = useState(true);
  const [operator, setOperator] = useState("");
  const [number, setNumber] = useState("");
  const [holder, setHolder] = useState("");
  const [proofId, setProofId] = useState<string | null>(null);
  const [proofName, setProofName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load() {
    const res = await fetch("/api/kyc/payout");
    if (res.ok) {
      const data = (await res.json()) as PayoutState;
      setState(data);
      setOperator(data.operator ?? "");
      setNumber(data.number ?? "");
      setHolder(data.holder ?? "");
      setProofId(data.addressProof?.id ?? null);
    }
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function uploadProof(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setMsg(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await fetch("/api/kyc/payout/document", { method: "POST", body: formData });
    setUploading(false);
    if (res.ok) {
      const data = await res.json();
      setProofId(data.id);
      setProofName(file.name);
      setMsg({ text: "Justificatif téléversé.", ok: true });
      return;
    }
    const data = await res.json().catch(() => ({}));
    setMsg({
      text:
        data.error === "unsupported_file_type"
          ? "Formats acceptés : JPG, PNG, WEBP ou PDF."
          : data.error === "file_too_large"
            ? "Fichier trop volumineux — 5 Mo maximum."
            : "Échec du téléversement.",
      ok: false,
    });
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    setMsg(null);
    const res = await fetch("/api/kyc/payout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ operator, number: number.trim(), holder: holder.trim(), addressProofDocId: proofId }),
    });
    setSubmitting(false);
    if (res.ok) {
      await load();
      setMsg({ text: "Dossier envoyé. Un administrateur KYC va vérifier votre compte de versement.", ok: true });
      return;
    }
    const data = await res.json().catch(() => ({}));
    setMsg({
      text:
        data.error === "identity_required"
          ? "Complétez d'abord votre vérification d'identité (le dossier financier la référence, il ne la remplace pas)."
          : data.error === "address_proof_required"
            ? "Téléversez d'abord votre justificatif de domicile."
            : res.status === 400
              ? "Vérifiez l'opérateur, le numéro et le nom du titulaire."
              : "Échec de l'envoi du dossier.",
      ok: false,
    });
  }

  const inputClass =
    "w-full h-10 px-3 rounded-xl border border-zinc-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition";

  if (loading) {
    return <div className="rounded-[20px] border border-gray-100 bg-white p-6 text-[13px] text-zinc-500">Chargement...</div>;
  }

  const status = state?.status ?? "non_renseigne";
  const verified = status === "verifie";
  // Un dossier déjà vérifié reste modifiable (on change de numéro), mais le changement
  // repasse par une instruction : le formulaire le dit au lieu de le laisser découvrir.
  const editingVerified = verified;

  return (
    <div className="space-y-5">
      <div className="bg-white rounded-[20px] border border-gray-100 p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-semibold text-[#0A1931]">Compte de versement</h2>
          <span className={`rounded-full px-3 py-1 text-[12px] font-semibold ${STATUS_CLASSES[status]}`}>
            {PAYOUT_STATUS_LABELS[status]}
          </span>
        </div>

        {/* Identité : état seul, aucune ressaisie. */}
        <div className={`mt-4 rounded-xl px-4 py-3 text-[12px] ${state?.identityReady ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}>
          {state?.identityReady ? (
            <>✓ Votre vérification d&apos;identité est complète ({state.identityDocsCount}/{state.identityDocsExpected} pièces).</>
          ) : (
            <>
              Votre vérification d&apos;identité est incomplète ({state?.identityDocsCount ?? 0}/
              {state?.identityDocsExpected ?? 4} pièces).{" "}
              <Link href="/kyc" className="font-semibold underline">
                La compléter
              </Link>{" "}
              — le dossier financier la référence, il ne la remplace pas.
            </>
          )}
        </div>

        {verified && (
          <p className="mt-3 rounded-xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-[12px] text-emerald-800">
            Votre compte est vérifié : les versements peuvent y être adressés. Modifier un numéro renvoie le dossier en
            instruction — une validation portait sur un numéro précis, elle ne vaut pas pour le suivant.
          </p>
        )}

        {status === "rejete" && state?.refusalReason && (
          <p className="mt-3 rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-[12px] text-red-700">
            Motif du rejet : {state.refusalReason}
          </p>
        )}

        <form onSubmit={submit} className="mt-5 space-y-4">
          <div>
            <label htmlFor="operator" className="block text-[13px] font-medium text-zinc-700 mb-1.5">
              Opérateur <span className="text-[#E8112D]">*</span>
            </label>
            <select id="operator" value={operator} onChange={(e) => setOperator(e.target.value)} className={inputClass} required>
              <option value="">Sélectionner un opérateur</option>
              {MOBILE_MONEY_OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>
                  {op.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="number" className="block text-[13px] font-medium text-zinc-700 mb-1.5">
              Numéro Mobile Money <span className="text-[#E8112D]">*</span>
            </label>
            <input
              id="number"
              value={number}
              onChange={(e) => setNumber(e.target.value)}
              className={inputClass}
              placeholder="+229 96 12 34 56"
              required
              minLength={8}
              maxLength={25}
            />
          </div>

          <div>
            <label htmlFor="holder" className="block text-[13px] font-medium text-zinc-700 mb-1.5">
              Titulaire du compte <span className="text-[#E8112D]">*</span>
            </label>
            <input
              id="holder"
              value={holder}
              onChange={(e) => setHolder(e.target.value)}
              className={inputClass}
              placeholder="Tel qu'inscrit auprès de l'opérateur"
              required
              minLength={2}
              maxLength={120}
            />
            <p className="mt-1 text-[11px] text-zinc-400">
              Indiquez le nom exact du titulaire : s&apos;il diffère de votre pièce d&apos;identité, l&apos;administrateur
              KYC le verra lors de l&apos;instruction.
            </p>
          </div>

          <div>
            <span className="block text-[13px] font-medium text-zinc-700 mb-1.5">
              Justificatif de domicile <span className="text-[#E8112D]">*</span>
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={uploadProof}
            />
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="h-10 px-5 rounded-full border border-zinc-200 text-[13px] font-medium hover:bg-zinc-100 transition disabled:opacity-50"
              >
                {uploading ? "Envoi..." : proofId ? "Remplacer le justificatif" : "Téléverser un justificatif"}
              </button>
              {proofId && <span className="text-[12px] text-emerald-700">✓ {proofName ?? "Justificatif joint"}</span>}
            </div>
          </div>

          <button
            type="submit"
            disabled={submitting || !operator || !number || !holder || !proofId}
            className="h-10 px-5 rounded-full bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#006e43] transition disabled:opacity-50"
          >
            {submitting ? "Envoi..." : editingVerified ? "Soumettre la modification" : "Vérifier mon compte"}
          </button>
        </form>

        {msg && (
          <p className={`mt-3 rounded-xl px-4 py-3 text-[12px] ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
            {msg.text}
          </p>
        )}
      </div>

      <div className="bg-white rounded-[20px] border border-gray-100 p-6">
        <h2 className="text-[15px] font-semibold text-[#0A1931]">Pourquoi ces informations</h2>
        <p className="mt-2 text-[13px] text-zinc-600">
          Les paiements passent par Mobile Money — MTN, Moov ou Celtiis. La plateforme ne demande pas d&apos;IBAN : les
          versements sont adressés à l&apos;opérateur, et le compte doit être contrôlé avant le premier paiement.
        </p>
      </div>
    </div>
  );
}
