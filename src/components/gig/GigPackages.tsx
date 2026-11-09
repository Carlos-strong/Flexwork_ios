"use client";

// Les trois formules d'un Gig (2026-11-08) — page publique du service, catalogue client.
//
// Fonctionne SANS JavaScript (correctif du 2026-11-08) : le choix de la formule repose sur de
// vrais boutons radio, et c'est le CSS (`:has(... :checked)`) qui affiche le panneau de la formule
// cochée. Avec les anciens onglets pilotés par React, un clic donné avant l'hydratation de la
// page — réseau mobile lent, appareil modeste — était perdu, de même que « Commander ».
// Quand `orderHref` est fourni, « Commander » est un vrai lien : lui aussi marche d'emblée.
//
// Un Gig antérieur aux formules s'affiche avec son prix unique.

import { useId } from "react";
import { GIG_TIER_LABELS, type GigTier } from "@/lib/gig-rules";
import type { GigPackageView } from "@/lib/gig-serialize";

const fmt = (n: number) => n.toLocaleString("fr-FR");

// Panneau visible = celui dont le bouton radio est coché. Classes écrites EN ENTIER (et non
// construites) pour que Tailwind les génère.
const SHOW_PANEL: Record<GigTier, string> = {
  basique: "[&:has(input[value=basique]:checked)_[data-panel=basique]]:block",
  standard: "[&:has(input[value=standard]:checked)_[data-panel=standard]]:block",
  premium: "[&:has(input[value=premium]:checked)_[data-panel=premium]]:block",
};

const ORDER_CLASS =
  "mt-5 flex h-11 w-full items-center justify-center rounded-xl bg-[#FF6B35] text-[14px] font-semibold text-white hover:bg-[#E85A24] disabled:opacity-50 transition";

export function GigPackages({
  packages,
  currency,
  fallback,
  onOrder,
  orderHref,
  orderLabel = "Commander",
  busy = false,
  initialTier,
}: {
  packages: GigPackageView[];
  currency: string;
  /** Gig sans formules : prix et délai uniques. */
  fallback?: { prix: number; delaiJours: number };
  /** Commande par action JavaScript (catalogue client : crée la commande). */
  onOrder?: (tier: GigTier | null) => void;
  /** Commande par LIEN (page publique) : fonctionne avant l'hydratation. Prioritaire sur `onOrder`. */
  orderHref?: (tier: GigTier | null) => string;
  orderLabel?: string;
  busy?: boolean;
  /** Formule cochée à l'arrivée (ex. choisie sur la page publique du service). */
  initialTier?: GigTier | null;
}) {
  const name = `formule-${useId()}`;

  const orderControl = (tier: GigTier | null, prix: number) => {
    const label = `${orderLabel} — ${fmt(prix)} ${currency}`;
    if (orderHref) {
      return (
        <a href={orderHref(tier)} className={ORDER_CLASS} style={{ textDecoration: "none" }}>
          {label}
        </a>
      );
    }
    if (!onOrder) return null;
    return (
      <button type="button" disabled={busy} onClick={() => onOrder(tier)} className={ORDER_CLASS}>
        {label}
      </button>
    );
  };

  if (packages.length === 0) {
    if (!fallback) return null;
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-5">
        <p className="text-[24px] font-bold text-[#0A1931]">
          {fmt(fallback.prix)} <span className="text-[14px] font-semibold text-zinc-500">{currency}</span>
        </p>
        <p className="mt-1 text-[13px] text-zinc-600">Livraison sous {fallback.delaiJours} jour{fallback.delaiJours > 1 ? "s" : ""}</p>
        {orderControl(null, fallback.prix)}
      </div>
    );
  }

  const checked: GigTier = packages.some((p) => p.tier === initialTier) ? initialTier! : packages.some((p) => p.tier === "standard") ? "standard" : packages[0].tier;

  return (
    <div className={`overflow-hidden rounded-2xl border border-zinc-200 bg-white ${packages.map((p) => SHOW_PANEL[p.tier]).join(" ")}`}>
      <fieldset className="grid grid-cols-3 border-b border-zinc-200">
        <legend className="sr-only">Formule</legend>
        {packages.map((p) => (
          <div key={p.tier} className="relative">
            <input
              type="radio"
              id={`${name}-${p.tier}`}
              name={name}
              value={p.tier}
              defaultChecked={p.tier === checked}
              className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
            <label
              htmlFor={`${name}-${p.tier}`}
              className="pointer-events-none flex h-11 items-center justify-center text-[13px] font-semibold text-zinc-500 transition peer-hover:bg-zinc-50 peer-hover:text-[#0A1931] peer-checked:border-b-2 peer-checked:border-[#0A1931] peer-checked:text-[#0A1931] peer-focus-visible:ring-2 peer-focus-visible:ring-inset peer-focus-visible:ring-[#008751]/40"
            >
              {GIG_TIER_LABELS[p.tier]}
            </label>
          </div>
        ))}
      </fieldset>
      {packages.map((p) => (
        <div key={p.tier} data-panel={p.tier} className="hidden p-5">
          <div className="flex items-baseline justify-between gap-3">
            <p className="text-[15px] font-bold text-[#0A1931]">{p.titre}</p>
            <p className="text-[22px] font-bold text-[#0A1931] whitespace-nowrap">
              {fmt(p.prix)} <span className="text-[13px] font-semibold text-zinc-500">{currency}</span>
            </p>
          </div>
          <p className="mt-2 text-[14px] leading-relaxed text-zinc-600 whitespace-pre-line">{p.description}</p>
          <ul className="mt-4 space-y-1.5 text-[13px] font-medium text-[#0A1931]">
            <li>⏱ Livraison sous {p.delaiJours} jour{p.delaiJours > 1 ? "s" : ""}</li>
            <li>↻ {p.revisions === 0 ? "Aucune révision" : `${p.revisions} révision${p.revisions > 1 ? "s" : ""}`}</li>
          </ul>
          {orderControl(p.tier, p.prix)}
        </div>
      ))}
    </div>
  );
}
