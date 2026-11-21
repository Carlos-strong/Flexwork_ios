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
      <div className="min-h-screen bg-[#F6F5FA] text-[#191224] flex items-center justify-center px-4">
        <div className="max-w-[560px] w-full bg-white border border-[#E7E2F0] rounded-xl p-8 text-center">
          <div className="text-[48px] mb-4">📩</div>
          <h1 className="text-[18px] font-bold text-[#4C1D95] mb-2">
            Signalement envoyé
          </h1>
          <p className="text-[13px] text-[#6B6478] mb-5">
            Votre signalement a été transmis à l&apos;équipe de modération. Il sera examiné
            dans les meilleurs délais. Aucune action automatique n&apos;est déclenchée.
          </p>
          <Link href="/" className="inline-flex h-10 px-5 rounded-full bg-[#4C1D95] text-white text-[13px] font-semibold items-center hover:bg-[#3B1578]" style={{ textDecoration: "none" }}>
            Retour à l&apos;accueil
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F6F5FA] text-[#191224]">
      <div className="fluid-form [--fw:560px] mx-auto px-4 py-5 space-y-4">
        <div className="bg-white border border-[#E7E2F0] rounded-xl p-4 lg:p-5 space-y-4">
          <h1 className="text-[13px] font-semibold">Signaler un contenu</h1>

          <div className="rounded-xl border border-[#E7E2F0] bg-[#F6F5FA] p-3.5 text-[12.5px] text-[#4A4258] leading-relaxed">
            <strong className="text-[#191224]">Important :</strong> un signalement ouvre une revue manuelle par l&apos;Admin
            Modération. Il ne déclenche <strong className="text-[#191224]">aucune action automatique</strong> (suppression,
            suspension). Chaque signalement est traité individuellement avec justification
            obligatoire (US-306).
          </div>

          {error && <div className="rounded-xl border border-[#FECACA] bg-[#FEECEB] p-3 text-[13px] text-[#B42318]">{error}</div>}

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="block text-[12px] font-medium text-[#4A4258] mb-1">Type de contenu signalé <span className="text-[#B42318]">*</span></label>
              <select
                required
                value={targetType}
                onChange={(e) => setTargetType(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#E7E2F0] text-[13px] bg-white focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]"
              >
                <option value="">-- Choisir --</option>
                <option value="declaration">Déclaration (assurance / qualification)</option>
                <option value="profile">Profil prestataire</option>
                <option value="mission">Mission</option>
                <option value="review">Avis</option>
              </select>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[#4A4258] mb-1">Identifiant du contenu</label>
              <input
                type="text"
                placeholder="ID de la déclaration, du profil ou de la mission"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
                className="w-full h-10 px-3 rounded-lg border border-[#E7E2F0] text-[13px] focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]"
              />
              <p className="text-[11px] text-[#9A93A8] mt-1">
                Optionnel — si vous ne connaissez pas l&apos;identifiant, décrivez le contenu
                dans le motif.
              </p>
            </div>

            <div>
              <label className="block text-[12px] font-medium text-[#4A4258] mb-1">Motif du signalement <span className="text-[#B42318]">*</span></label>
              <textarea
                rows={4}
                required
                minLength={10}
                placeholder="Décrivez précisément pourquoi ce contenu vous semble frauduleux ou inapproprié..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-[#E7E2F0] text-[13px] resize-y focus:outline-none focus:ring-2 focus:ring-[#4C1D95]/20 focus:border-[#4C1D95]"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full h-10 rounded-lg bg-[#B42318] text-white text-[13px] font-semibold hover:bg-[#B42318] transition-colors disabled:opacity-50"
            >
              {submitting ? "Envoi..." : "Envoyer le signalement"}
            </button>
          </form>
        </div>

        <div className="bg-[#FEECEB] border border-[#FECACA] rounded-xl p-4">
          <strong className="text-[#991B1B] text-[13px]">⚠️ Usage abusif</strong>
          <p className="text-[12.5px] text-[#6B6478] mt-1.5">
            Les signalements abusifs ou répétés sans fondement sont tracés et peuvent entraîner
            des restrictions sur votre compte. Utilisez cette fonction de façon responsable.
          </p>
        </div>
      </div>
    </div>
  );
}
