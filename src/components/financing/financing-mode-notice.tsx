"use client";

// Consigne de chiffrage affichée au PRESTATAIRE (2026-09-10) — pendant côté prestataire du
// sélecteur de mode du formulaire de publication (src/app/missions/new/page.tsx).
//
// Sans ce bloc, déplacer le choix du mode à la publication n'aurait servi à rien : le client
// choisissait plus tôt, mais le prestataire chiffrait toujours à l'aveugle et découvrait le
// régime de paiement à la génération du contrat — exactement le décalage que le déplacement
// cherchait à supprimer (voir l'en-tête de src/lib/financing-modes.ts).
//
// Aucun texte n'est écrit ici : tout vient de `providerBrief`, dérivé des primitives du mode.
// Le composant ne fait que rendre — il n'interprète aucun mode lui-même.

import { getFinancingMode, providerBrief } from "@/lib/financing-modes";

export function FinancingModeNotice({
  modeKey,
  quoteMode,
  className = "",
}: {
  // Null pour toute mission publiée avant l'introduction des modes : on n'affiche alors rien
  // plutôt que d'inventer un régime par défaut que le contrat ne suivra pas.
  modeKey: string | null | undefined;
  quoteMode: boolean;
  className?: string;
}) {
  const mode = modeKey ? getFinancingMode(modeKey) : null;
  if (!mode) return null;

  const brief = providerBrief(mode, { quoteMode });

  return (
    <div className={`rounded-xl border border-[#008751]/25 bg-[#008751]/[0.04] p-4 ${className}`}>
      <div className="flex flex-wrap items-center gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-[#008751]/10 text-[#00623A]">
          Mode de financement
        </span>
        <strong className="text-[13px] text-[#0f172a]">{mode.label}</strong>
      </div>
      <p className="text-[13px] text-[#334155] leading-relaxed">{brief.headline}</p>
      <ul className="mt-2 space-y-1">
        {brief.points.map((point) => (
          <li key={point} className="text-[12px] text-[#475569] leading-relaxed flex gap-2">
            <span aria-hidden className="text-[#008751] shrink-0">•</span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-[#64748B] mt-2">
        Choisi par le client à la publication — il sera figé dans le contrat, sans modification possible ensuite.
      </p>
    </div>
  );
}
