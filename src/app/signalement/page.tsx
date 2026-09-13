"use client";

import { useState } from "react";
import Link from "next/link";

// US-802 — Signalement d'une déclaration ou d'un profil suspect.
// Alimente la file de travail de l'Admin Modération (US-306).
// Un signalement ouvre une revue, il ne déclenche pas d'action punitive automatique.
// Style harmonisé (2026-08-29) sur le même modèle Tailwind que missions/[id]/devis/
// page.tsx (palette #0f172a/#E2E8F0/#008751) — logique et appel API strictement inchangés.
export default function SignalementPage() {
  const [targetType, setTargetType] = useState("");
  const [targetId, setTargetId] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const res = await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        targetType,
        targetId: targetId || undefined,
        reason,
      }),
    });

    setSubmitting(false);
    if (res.ok) {
      setSuccess(true);
    } else {
      setError("Échec de l'envoi du signalement. Réessayez.");
    }
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a] flex items-center justify-center px-4">
        <div className="max-w-[560px] w-full bg-white border border-[#E2E8F0] rounded-xl p-8 text-center">
          <div className="text-[48px] mb-4">📩</div>
          <h1 className="text-[18px] font-bold text-[#008751] mb-2">
            Signalement envoyé
          </h1>
          <p className="text-[13px] text-[#64748B] mb-5">
            Votre signalement a été transmis à l&apos;équipe de modération. Il sera examiné
            dans les meilleurs délais. Aucune action automatique n&apos;est déclenchée.
          </p>
          <Link href="/" className="inline-flex h-10 px-5 rounded-lg bg-[#008751] text-white text-[13px] font-semibold items-center hover:bg-[#007a49]" style={{ textDecoration: "none" }}>
            Retour à l&apos;accueil
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAF9] text-[#0f172a]">
      <div className="max-w-[560px] mx-auto px-4 py-5 space-y-4">
        <div className="bg-white border border-[#E2E8F0] rounded-xl p-4 lg:p-5 space-y-4">
          <h1 className="text-[13px] font-semibold">Signaler un contenu</h1>

          <div className="rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-3.5 text-[12.5px] text-[#475569] leading-relaxed">
            <strong className="text-[#0f172a]">Important :</strong> un signalement ouvre une revue manuelle par l&apos;Admin
            Modération. Il ne déclenche <strong className="text-[#0f172a]">aucune action automatique</strong> (suppression,
            suspension). Chaque signalement est traité individuellement avec justification
            obligatoire (US-306).
          </div>

          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEF2F2] p-3 text-[13px] text-[#B91C1C]">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-[#475569] mb-1">Type de contenu signalé <span className="text-[#E8112D]">*</span></label>
              <select
                required
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
              >
                <option value="">-- Choisir --</option>
                <option value="declaration">Déclaration (assurance / qualification)</option>
                <option value="profile">Profil prestataire</option>
                <option value="mission">Mission</option>
                <option value="review">Avis</option>
              </select>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[#475569] mb-1">Identifiant du contenu</label>
              <input
                type="text"
                placeholder="ID de la déclaration, du profil ou de la mission"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#E2E8F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
              />
              <p className="text-[11px] text-[#94A3B8] mt-1">
                Optionnel — si vous ne connaissez pas l&apos;identifiant, décrivez le contenu
                dans le motif.
              </p>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[#475569] mb-1">Motif du signalement <span className="text-[#E8112D]">*</span></label>
              <textarea
                rows={4}
                required
                minLength={10}
                placeholder="Décrivez précisément pourquoi ce contenu vous semble frauduleux ou inapproprié..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E2E8F0] text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751]"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-10 rounded-lg bg-[#DC2626] text-white text-[13px] font-semibold hover:bg-[#B91C1C] transition-colors disabled:opacity-50"
            >
              {submitting ? "Envoi..." : "Envoyer le signalement"}
            </button>
          </form>
        </div>

        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4">
          <strong className="text-[#991B1B] text-[13px]">⚠️ Usage abusif</strong>
          <p className="text-[12.5px] text-[#64748B] mt-1.5">
            Les signalements abusifs ou répétés sans fondement sont tracés et peuvent entraîner
            des restrictions sur votre compte. Utilisez cette fonction de façon responsable.
          </p>
        </div>
      </div>
    </div>
  );
}
