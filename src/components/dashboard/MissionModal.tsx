"use client";

import { useState } from "react";
import { ArrowLeft, X, Send, LoaderCircle } from "lucide-react";
import { STATUS_LABEL, RISK_BADGE, type ApiMission } from "./types";

type MissionModalProps = {
  mission: ApiMission | null;
  isOpen: boolean;
  onClose: () => void;
  userId: string | undefined;
  myProposalIds: Set<string>;
  onProposalSent: (missionId: string) => void;
  /** Contenu additionnel à injecter entre la description et le formulaire */
  extraContent?: React.ReactNode;
  /** Placeholder pour le textarea du message */
  messagePlaceholder?: string;
};

export default function MissionModal({
  mission, isOpen, onClose, userId,
  myProposalIds, onProposalSent, extraContent, messagePlaceholder,
}: MissionModalProps) {
  // Ne gère pas les toasts ici — le parent les gère
  const [montant, setMontant] = useState("");
  const [delai, setDelai] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Reset on open
  if (isOpen && mission && !montant && !feedback) {
    // State initial déjà ok
  }

  if (!mission) return null;

  const st = STATUS_LABEL[mission.status] ?? STATUS_LABEL.brouillon;
  const risk = RISK_BADGE[mission.riskLevel] ?? RISK_BADGE.low;

  const submitProposal = async () => {
    if (!mission) return;
    setSubmitting(true); setFeedback(null);
    const delaiPropose = delai.trim() ? Number(delai) : undefined;
    const res = await fetch(`/api/missions/${mission.id}/proposals`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ montant: Number(montant), delaiPropose, message: message || undefined }),
    });
    setSubmitting(false);
    if (res.ok) {
      onProposalSent(mission.id);
      onClose();
    } else {
      const d = await res.json().catch(() => ({}));
      setFeedback(
        d.error === "kyc_not_verified" ? "KYC requis pour candidater."
        : d.error === "mission_not_open" ? "Mission plus ouverte."
        : "Erreur lors de l'envoi."
      );
    }
  };

  const handleClose = () => { setMontant(""); setDelai(""); setMessage(""); setFeedback(null); onClose(); };

  return (
    <div className={`fixed inset-0 z-40 flex items-center justify-center p-4 md:p-6 transition-all duration-300 ${isOpen ? "pointer-events-auto" : "pointer-events-none"}`}>
      <div onClick={handleClose} className={`absolute inset-0 bg-black/40 backdrop-blur-md transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0"}`} />
      <div className={`relative w-full max-w-xl max-h-[85vh] bg-white rounded-[24px] shadow-2xl flex flex-col overflow-hidden transition-all duration-[300ms] ${isOpen ? "opacity-100 scale-100" : "opacity-0 scale-[0.95]"}`}>
        {/* Header */}
        <div className="shrink-0 px-6 pt-5 pb-5 border-b border-gray-100">
          <div className="flex items-center justify-between gap-3">
            <button onClick={handleClose} className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex items-center gap-2">
              <span className={`px-3 py-1 rounded-full text-[12px] font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
              <button onClick={handleClose} className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center hover:bg-gray-200 transition-colors">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
          <h2 className="mt-5 text-[22px] font-bold leading-tight tracking-tight text-zinc-900">{mission.titre}</h2>

          {/* Infos */}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <div className="rounded-2xl bg-gray-50 p-3">
              <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">Domaine</div>
              <div className="text-[14px] font-semibold mt-1">{mission.domaine}</div>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3">
              <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">Budget</div>
              <div className="text-[14px] font-semibold mt-1">{mission.budget.toLocaleString("fr-FR")} {mission.currency}</div>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3">
              <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">Délai</div>
              <div className="text-[14px] font-semibold mt-1">{mission.delaiJours} jours</div>
            </div>
            <div className="rounded-2xl bg-gray-50 p-3">
              <div className="text-[10px] uppercase tracking-widest text-zinc-400 font-semibold">{mission.riskLevel === "high" ? "⚠ Risque" : "Risque"}</div>
              <div className={`text-[14px] font-semibold mt-1 capitalize ${risk.text}`}>{risk.label}</div>
            </div>
          </div>
        </div>

        {/* Corps */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 overscroll-contain">
          {mission.description && (
            <div>
              <h3 className="text-[11px] uppercase tracking-widest font-semibold text-zinc-500 mb-2">Description</h3>
              <p className="text-[13px] text-zinc-600 leading-relaxed">{mission.description}</p>
            </div>
          )}

          {/* Contenu additionnel (alertes risque, etc.) */}
          {extraContent}

          {/* Formulaire de candidature */}
          {mission.status === "publiee" && (
            <div className="rounded-[18px] border border-[#008751]/20 bg-[#f0faf5] p-4">
              <h3 className="font-semibold text-[15px] mb-1 flex items-center gap-2">
                <Send className="w-4 h-4 text-[#008751]" /> Candidater
              </h3>
              <p className="text-[12px] text-zinc-500 mb-3">Proposez votre prix et un message au client.</p>

              {feedback && (
                <div className={`mb-3 px-3 py-2 rounded-xl text-[12px] font-medium ${feedback.includes("envoyée") ? "bg-[#f0faf5] text-[#008751] border border-[#008751]/20" : "bg-red-50 text-[#E8112D] border border-red-100"}`}>
                  {feedback}
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className="text-[11px] uppercase tracking-widest font-semibold text-zinc-500">Montant proposé ({mission.currency})</label>
                  <input type="number" value={montant} onChange={(e) => setMontant(e.target.value)}
                    placeholder={String(mission.budget)}
                    className="mt-1 w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-widest font-semibold text-zinc-500">Délai proposé (jours) — optionnel</label>
                  <input type="number" min={1} value={delai} onChange={(e) => setDelai(e.target.value)}
                    placeholder={String(mission.delaiJours)}
                    className="mt-1 w-full h-10 px-3 rounded-xl bg-white border border-gray-200 text-[14px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition" />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-widest font-semibold text-zinc-500">Message (optionnel)</label>
                  <textarea value={message} onChange={(e) => setMessage(e.target.value)}
                    placeholder={messagePlaceholder ?? "Décrivez votre approche, expérience pertinente..."}
                    className="mt-1 w-full min-h-[80px] rounded-xl bg-white border border-gray-200 p-3 text-[13px] focus:outline-none focus:ring-2 focus:ring-[#008751]/20 focus:border-[#008751] transition resize-none" />
                </div>
                <button onClick={submitProposal} disabled={submitting || !montant}
                  className="w-full h-11 rounded-full bg-[#008751] text-white text-[14px] font-semibold shadow-[0_4px_14px_rgba(0,135,81,0.25)] hover:brightness-110 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed">
                  {submitting ? <LoaderCircle className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {submitting ? "Envoi..." : "Envoyer ma candidature"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
