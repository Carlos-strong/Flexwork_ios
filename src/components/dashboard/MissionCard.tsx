"use client";

import { Check, ChevronRight } from "lucide-react";
import { STATUS_LABEL, RISK_BADGE, type ApiMission } from "./types";

type MissionCardProps = {
  mission: ApiMission;
  alreadyApplied: boolean;
  isPressing: boolean;
  onOpen: (m: ApiMission) => void;
  /** Couleurs du gradient de l'avatar domaine (ex: "from-[#008751] to-[#FCD116]") */
  avatarGradient?: string;
  showRiskBadge?: boolean;
};

export default function MissionCard({
  mission: m, alreadyApplied, isPressing, onOpen,
  avatarGradient = "from-[#008751] to-[#FCD116]",
  showRiskBadge = false,
}: MissionCardProps) {
  const st = STATUS_LABEL[m.status] ?? STATUS_LABEL.brouillon;
  const risk = showRiskBadge ? (RISK_BADGE[m.riskLevel] ?? RISK_BADGE.low) : null;

  return (
    <button
      onClick={() => onOpen(m)}
      disabled={alreadyApplied}
      className={`text-left group relative bg-white rounded-[20px] border shadow-[0_4px_20px_rgba(0,0,0,0.04)] p-5 flex flex-col gap-4 transition-all duration-300 ${
        alreadyApplied
          ? "opacity-50 cursor-not-allowed border-gray-100"
          : "border-gray-100 hover:shadow-[0_8px_30px_rgba(0,0,0,0.08)] hover:-translate-y-[2px] active:scale-[0.98]"
      } ${!alreadyApplied && isPressing ? "scale-[0.98] opacity-80" : ""}`}
    >
      {/* Titre + statut */}
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-[16px] leading-[1.25] line-clamp-2 pr-2 tracking-tight text-zinc-900">
          {m.titre}
        </h3>
        <span className={`shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${st.bg} ${st.text}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />{st.label}
        </span>
      </div>

      {/* Domaine + délai + risque */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${avatarGradient} flex items-center justify-center text-white text-[11px] font-bold`}>
          {m.domaine.slice(0, 2).toUpperCase()}
        </div>
        <div className="text-[13px]">
          <span className="font-medium text-zinc-800">{m.domaine}</span>
          <span className="text-zinc-300 mx-1.5">•</span>
          <span className="text-zinc-500">{m.delaiJours} jours</span>
        </div>
        {risk && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${risk.bg} ${risk.text}`}>
            {risk.label}
          </span>
        )}
      </div>

      {/* Description */}
      {m.description && (
        <p className="text-[13px] text-zinc-500 line-clamp-2 leading-snug">{m.description}</p>
      )}

      {/* Budget + action */}
      <div className="flex items-center justify-between pt-1 border-t border-gray-50 mt-1">
        <span className="font-semibold text-[15px] tracking-tight text-zinc-800">
          {m.budget.toLocaleString("fr-FR")} {m.currency}
        </span>
        {alreadyApplied ? (
          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-gray-100 text-zinc-400 text-[11px] font-semibold">
            <Check className="w-3 h-3" /> Déjà candidaté
          </span>
        ) : (
          <span className="w-8 h-8 rounded-full bg-zinc-900 text-white flex items-center justify-center group-hover:translate-x-0.5 transition-transform">
            <ChevronRight className="w-4 h-4" />
          </span>
        )}
      </div>
    </button>
  );
}
