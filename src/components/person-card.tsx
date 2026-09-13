"use client";

import Link from "next/link";
import { Avatar } from "@/components/avatar";

// Carte prestataire/client — format et modèle repris EXACTEMENT de
// src/components/afrilance/TalentsAfrique.tsx ("Talents d'Afrique", page d'accueil publique
// — c'est la source réelle de profil.png) : avatar circulaire, nom + drapeau pays, sous-titre
// (profession/rôle • ville), note ★ (N avis), ligne de prix "À partir de {tarif}". Un seul
// composant partagé pour les deux rôles plutôt qu'une carte dupliquée par écran — utilisé par
// /recherche (résultats de recherche prestataires) et partout où une carte de ce format est
// nécessaire avec de vraies données (jamais les 4 profils d'exemple de la page d'accueil).
export function countryFlag(code?: string | null): string {
  if (!code || code.length !== 2) return "🌍";
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

export type PersonCardProps = {
  name: string;
  countryCode?: string | null;
  avatarSrc?: string | null;
  initials: string;
  /** Ex. "Designer UI/UX Wax • Cotonou" (prestataire) ou "Client • Cotonou". */
  subtitle: string;
  /** Note moyenne réelle (Review), null si aucun avis pour l'instant — jamais fabriquée. */
  rating?: number | null;
  reviewCount?: number;
  /** "À partir de {tarif} {unité}" — omis si aucun tarif indicatif déclaré (jamais inventé). */
  priceLabel?: string | null;
  href?: string;
  className?: string;
};

export function PersonCard({
  name,
  countryCode,
  avatarSrc,
  initials,
  subtitle,
  rating,
  reviewCount,
  priceLabel,
  href,
  className = "",
}: PersonCardProps) {
  const content = (
    <div className={`bg-white rounded-2xl p-4 lg:p-5 shadow-sm border border-orange-100 ${href ? "hover:shadow-xl hover:-translate-y-1 transition" : ""} ${className}`}>
      <div className="flex items-start gap-3 lg:gap-4">
        <Avatar src={avatarSrc} initials={initials} size={56} className="shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-base truncate">
            {name} {countryCode && <span>{countryFlag(countryCode)}</span>}
          </p>
          <p className="text-sm text-gray-500 truncate">{subtitle}</p>
          {rating != null && (
            <div className="flex items-center gap-1 mt-1 text-sm">
              <span className="text-[#F7C948]">★</span>
              <span className="font-bold">{rating.toFixed(1)}</span>
              {reviewCount != null && <span className="text-gray-400">({reviewCount})</span>}
            </div>
          )}
        </div>
      </div>

      {priceLabel && (
        <div className="mt-4 flex items-center justify-between">
          <p className="text-sm text-gray-500">À partir de</p>
          <p className="font-extrabold text-lg text-[#0A1931]">{priceLabel}</p>
        </div>
      )}
    </div>
  );

  if (!href) return content;
  return (
    <Link href={href} style={{ textDecoration: "none", color: "inherit" }} className="block">
      {content}
    </Link>
  );
}
