"use client";

import { useState } from "react";
import { AdminNav } from "@/components/admin-nav";

// Médiation — aligné sur formulaires-flexwork-tous-profils.html.
// L'admin propose, ne tranche jamais. Double validation pour les rejets.
// Style harmonisé (2026-08-29) sur le même modèle Tailwind que missions/[id]/devis/
// page.tsx (palette #0f172a/#E2E8F0/#008751).
//
// Répartition financière (2026-09-15) : la proposition porte désormais ses montants — libérer au
// prestataire, rembourser au client, et, implicitement, maintenir gelé le reste (§24). Ils ne
// s'exécutent qu'une fois acceptés par les DEUX parties (POST .../respond).
const inputCls =
  "w-full h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]";

export default function AdminMediationPage() {
  const [mediationId, setMediationId] = useState("");
  const [resolution, setResolution] = useState("");
  const [justification, setJustification] = useState("");
  const [releaseAmount, setReleaseAmount] = useState("");
  const [refundAmount, setRefundAmount] = useState("");
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);

  async function handlePropose(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch(`/api/admin/mediations/${mediationId}/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        proposedResolution: resolution,
        justification,
        resolutionAmount: releaseAmount ? Math.round(Number(releaseAmount)) : undefined,
        refundAmount: refundAmount ? Math.round(Number(refundAmount)) : undefined,
      }),
    });
    if (res.ok) {
      setFeedback({ ok: true, text: "Proposition envoyée aux deux parties — en attente de leur acceptation ou refus." });
      return;
    }
    const data = await res.json().catch(() => ({}));
    setFeedback({
      ok: false,
      text:
        data.error === "amount_exceeds_escrow"
          ? `La répartition dépasse ce qui reste au séquestre (${Number(data.held ?? 0).toLocaleString("fr-FR")} XOF).`
          : data.error === "mediation_closed"
            ? "Cette médiation est déjà close."
            : "Échec de l'envoi — vérifiez l'identifiant de la médiation.",
    });
  }

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <AdminNav />
      <div className="max-w-[720px] mx-auto px-4 py-5 space-y-4">
        <h1 className="text-[18px] font-bold">Admin Médiation</h1>

        <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3.5 text-[12.5px] text-[#92400E] leading-relaxed">
          <strong>Vous proposez, vous ne tranchez pas.</strong> Ne jamais libérer ou bloquer de fonds unilatéralement.
          Toute proposition doit être soumise à l&apos;acceptation des deux parties.
        </div>

        {feedback && (
          <div
            className={`rounded-xl border p-3 text-[13px] ${feedback.ok ? "border-[#BFDBFE] bg-[#EFF6FF] text-[#1E40AF]" : "border-[#FECACA] bg-[#FEF2F2] text-[#B91C1C]"}`}
            role={feedback.ok ? "status" : "alert"}
          >
            {feedback.text}
          </div>
        )}

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
          <h3 className="text-[13px] font-semibold mb-3">Proposer une résolution</h3>
          <form onSubmit={handlePropose} className="space-y-3">
            <div>
              <label htmlFor="mediation-id" className="block text-[12px] font-medium text-[#475569] mb-1">Identifiant de la médiation</label>
              <input id="mediation-id" type="text" required value={mediationId} onChange={(e) => setMediationId(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label htmlFor="mediation-resolution" className="block text-[12px] font-medium text-[#475569] mb-1">Proposition de résolution</label>
              <textarea
                id="mediation-resolution"
                rows={4} required minLength={5} value={resolution} onChange={(e) => setResolution(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="mediation-release" className="block text-[12px] font-medium text-[#475569] mb-1">Libérer au prestataire (XOF)</label>
                <input id="mediation-release" type="number" min={0} step={500} value={releaseAmount} onChange={(e) => setReleaseAmount(e.target.value)} placeholder="0" className={`${inputCls} tabular-nums`} />
              </div>
              <div>
                <label htmlFor="mediation-refund" className="block text-[12px] font-medium text-[#475569] mb-1">Rembourser au client (XOF)</label>
                <input id="mediation-refund" type="number" min={0} step={500} value={refundAmount} onChange={(e) => setRefundAmount(e.target.value)} placeholder="0" className={`${inputCls} tabular-nums`} />
              </div>
            </div>
            <p className="text-[11.5px] text-[#64748B]">
              Ce qui n&apos;est ni libéré ni remboursé reste gelé au séquestre. Laissez les deux montants vides pour une résolution non
              financière.
            </p>
            <div>
              <label htmlFor="mediation-justification" className="block text-[12px] font-medium text-[#475569] mb-1">Justification (obligatoire)</label>
              <input id="mediation-justification" type="text" required value={justification} onChange={(e) => setJustification(e.target.value)} className={inputCls} />
            </div>
            <button type="submit" className="h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold hover:bg-[#007a49] transition-colors">
              Soumettre la proposition aux deux parties
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
