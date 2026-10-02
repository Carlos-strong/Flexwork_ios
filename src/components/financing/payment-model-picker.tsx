"use client";

// Choix du modèle de paiement par le PRESTATAIRE, dans son devis (2026-10-01).
//
// Fixe ou par jalons : c'est la soumission du devis qui le décide, plus la publication de la
// mission. Le prestataire est celui qui sait si son travail se découpe en livrables payables
// un à un ; le client, lui, l'accepte (ou demande une révision) en même temps que le prix.
//
// Deux niveaux, parce que les deux questions sont de nature différente : « fixe ou jalons ? »
// change QUAND le prestataire est payé, la variante de jalons (progression, retenue, séquestre
// unique) change COMMENT. Les textes viennent tous du catalogue (definition, providerBrief) —
// ce composant ne décrit aucun mode lui-même.

import {
  DEVIS_FIXED_MODE_KEY,
  DEFAULT_FINANCING_MODE_KEY,
  getFinancingMode,
  listDevisPaymentModes,
  providerBrief,
} from "@/lib/financing-modes";

export function PaymentModelPicker({
  value,
  onChange,
  quoteMode,
  className = "",
}: {
  value: string | null;
  onChange: (key: string) => void;
  // Mission en mode devis : les lignes deviennent les jalons. En prix fixe, il n'y a qu'un
  // montant — le client détaillera les jalons à la génération du contrat (voir providerBrief).
  quoteMode: boolean;
  className?: string;
}) {
  const jalonModes = listDevisPaymentModes().filter((m) => m.family === "jalon");
  const selected = value ? getFinancingMode(value) : null;
  const family = selected ? (selected.family === "fixe" ? "fixe" : "jalon") : null;
  const brief = selected ? providerBrief(selected, { quoteMode }) : null;

  const tile = (active: boolean) =>
    `flex-1 text-left p-3 rounded-xl border transition ${
      active ? "border-[#008751] bg-[#008751]/[0.05] ring-1 ring-[#008751]/30" : "border-[#E2E8F0] bg-white hover:border-[#CBD5E1]"
    }`;

  return (
    <fieldset className={`rounded-xl border border-[#E2E8F0] bg-[#F8FAF9] p-4 ${className}`}>
      <legend className="px-1 text-[11px] font-semibold tracking-wide uppercase text-[#64748B]">
        Modèle de paiement <span className="text-[#E8112D]">*</span>
      </legend>

      <div className="flex flex-col sm:flex-row gap-2">
        <button type="button" aria-pressed={family === "fixe"} onClick={() => onChange(DEVIS_FIXED_MODE_KEY)} className={tile(family === "fixe")}>
          <span className="block text-[13px] font-semibold text-[#0f172a]">Prix fixe</span>
          <span className="block text-[11.5px] text-[#64748B] mt-0.5">Un seul paiement, libéré à la fin après validation.</span>
        </button>
        <button
          type="button"
          aria-pressed={family === "jalon"}
          onClick={() => family !== "jalon" && onChange(DEFAULT_FINANCING_MODE_KEY)}
          className={tile(family === "jalon")}
        >
          <span className="block text-[13px] font-semibold text-[#0f172a]">Par jalons</span>
          <span className="block text-[11.5px] text-[#64748B] mt-0.5">
            {quoteMode ? "Chaque ligne du devis est payée à sa validation." : "Paiement fractionné, livrable par livrable."}
          </span>
        </button>
      </div>

      {family === "jalon" && (
        <div className="mt-3 space-y-1.5">
          {jalonModes.map((m) => (
            <label
              key={m.key}
              className={`flex gap-2.5 p-2.5 rounded-lg border cursor-pointer transition ${
                value === m.key ? "border-[#008751] bg-white" : "border-transparent hover:bg-white"
              }`}
            >
              <input
                type="radio"
                name="paymentModelVariant"
                checked={value === m.key}
                onChange={() => onChange(m.key)}
                className="mt-0.5 accent-[#008751]"
              />
              <span>
                <span className="flex items-center gap-2 text-[12.5px] font-semibold text-[#0f172a]">
                  {m.label}
                  {m.key === DEFAULT_FINANCING_MODE_KEY && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[#E6F4EE] text-[#008751] font-semibold">Recommandé</span>
                  )}
                </span>
                <span className="block text-[11.5px] text-[#64748B] leading-snug mt-0.5">{m.definition}</span>
              </span>
            </label>
          ))}
        </div>
      )}

      {brief ? (
        <div className="mt-3 text-[12px] text-[#334155] leading-relaxed">
          <p>{brief.headline}</p>
          <ul className="mt-1.5 space-y-1">
            {brief.points.map((point) => (
              <li key={point} className="flex gap-2 text-[11.5px] text-[#475569]">
                <span aria-hidden className="text-[#008751] shrink-0">•</span>
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="mt-3 text-[12px] text-[#B45309]">Choisissez comment vous serez payé : le client l&apos;accepte avec votre devis.</p>
      )}
    </fieldset>
  );
}

/** Badge lisible du modèle de paiement d'un devis — pour le client qui le reçoit. */
export function PaymentModelBadge({ modeKey, className = "" }: { modeKey: string | null | undefined; className?: string }) {
  const mode = modeKey ? getFinancingMode(modeKey) : null;
  if (!mode) return null;
  const isFixed = mode.family === "fixe";
  return (
    <span
      title={mode.definition}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
        isFixed ? "bg-[#EFF6FF] text-[#1D4ED8]" : "bg-[#E6F4EE] text-[#00623A]"
      } ${className}`}
    >
      {isFixed ? "Prix fixe" : "Par jalons"}
      {!isFixed && <span className="font-normal opacity-80">· {mode.label}</span>}
    </span>
  );
}
