"use client";

import { useState } from "react";
import { AdminNav } from "@/components/admin-nav";

// Modération — aligné sur formulaires-flexwork-tous-profils.html.
// Retrait de déclaration sur signalement, justification obligatoire,
// journalisé dans admin_audit_log (append-only, hash chaîné SHA-256).
// Style harmonisé (2026-08-29) sur le même modèle Tailwind que missions/[id]/devis/
// page.tsx (palette #0f172a/#E2E8F0/#008751) — logique et appel API strictement inchangés.
export default function AdminModerationPage() {
  const [declarationId, setDeclarationId] = useState("");
  const [justification, setJustification] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleRemove(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const res = await fetch(`/api/admin/declarations/${declarationId}/remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ justification }),
    });
    if (res.ok) {
      setFeedback("Déclaration retirée et journalisée dans admin_audit_log.");
      setDeclarationId("");
      setJustification("");
    } else {
      setFeedback("Échec du retrait — vérifiez l'identifiant de la déclaration.");
    }
  }

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <AdminNav />
      <div className="max-w-[720px] mx-auto px-4 py-5 space-y-4">
        <h1 className="text-[18px] font-bold">Admin Modération</h1>

        <div className="rounded-xl border border-[#E2E8F0] bg-white p-3.5 text-[12.5px] text-[#475569] leading-relaxed">
          <strong className="text-[#0f172a]">Action sur signalement uniquement.</strong> Pas de vérification systématique. Chaque retrait est
          journalisé avec justification dans <code className="px-1 py-0.5 rounded bg-[#F1F5F9] text-[12px]">admin_audit_log</code> (append-only, hash chaîné SHA-256).
        </div>

        {feedback && <div className="rounded-xl border border-[#FDE68A] bg-[#FFFBEB] p-3 text-[13px] text-[#92400E]">{feedback}</div>}

        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5">
          <h3 className="text-[13px] font-semibold mb-3">Retirer une déclaration signalée</h3>
          <form onSubmit={handleRemove} className="space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-[#475569] mb-1">Identifiant de la déclaration</label>
              <input
                type="text" required value={declarationId} onChange={(e) => setDeclarationId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
              />
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#475569] mb-1">Justification (obligatoire)</label>
              <textarea
                rows={3} required value={justification} onChange={(e) => setJustification(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
              />
            </div>
            <button type="submit" className="h-10 px-5 rounded-lg bg-[#DC2626] text-white text-[13px] font-semibold hover:bg-[#B91C1C] transition-colors">
              Retirer la déclaration
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
