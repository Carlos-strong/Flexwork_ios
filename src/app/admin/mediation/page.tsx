"use client";

import { useState } from "react";
import { AdminNav } from "@/components/admin-nav";

// Médiation — aligné sur formulaires-flexwork-tous-profils.html.
// L'admin propose, ne tranche jamais. Double validation pour les rejets.
// Style harmonisé (2026-08-29) sur le même modèle Tailwind que missions/[id]/devis/
// page.tsx (palette #0f172a/#E2E8F0/#008751) — logique et appel API strictement inchangés.
export default function AdminMediationPage() {
  const [mediationId, setMediationId] = useState("");
  const [resolution, setResolution] = useState("");
  const [justification, setJustification] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handlePropose(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch(`/api/admin/mediations/${mediationId}/propose`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ proposedResolution: resolution, justification }),
    });
    if (res.ok) {
      setFeedback("Proposition envoyée aux deux parties — en attente de leur acceptation ou refus.");
    } else {
      setFeedback("Échec de l'envoi — vérifiez l'identifiant de la médiation.");
    }
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

        {feedback && <div className="rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-[13px] text-[#1E40AF]">{feedback}</div>}

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
          <h3 className="text-[13px] font-semibold mb-3">Proposer une résolution</h3>
          <form onSubmit={handlePropose} className="space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-[#475569] mb-1">Identifiant de la médiation</label>
              <input
                type="text" required value={mediationId} onChange={(e) => setMediationId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#475569] mb-1">Proposition de résolution</label>
              <textarea
                rows={4} required minLength={5} value={resolution} onChange={(e) => setResolution(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#475569] mb-1">Justification (obligatoire)</label>
              <input
                type="text" required value={justification} onChange={(e) => setJustification(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
              />
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
