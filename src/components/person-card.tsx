"use client";

import Link from "next/link";
import { Avatar } from "@/components/avatar";
import { countryFlag } from "@/lib/country-flag";
import { countryName } from "@/lib/world-countries";

// Carte prestataire — « Talents d'Afrique » (accueil) et résultats de /recherche.
//
// Harmonisée (2026-11-08) sur le modèle des cartes « Nouveaux services publiés » et
// « Dernières missions publiées » de l'accueil, pour que les trois vitrines se lisent de la
// même façon :
//
//   1. étiquette     filière (Artisan, Expert digital…)
//   2. titre         métier principal — ce que la personne propose
//   3. ligne auteur  avatar · nom · drapeau du pays · « ✓ Identité vérifiée »
//   4. méta          ville · note ★ (N avis) — ou « Nouveau » sans avis, jamais une note inventée
//   5. bas de carte  tarif indicatif (ou « Sur devis ») à gauche, bouton orange à droite
//
// Toute la carte est cliquable (le lien du titre la couvre) ; le bouton est un second lien
// vers la même page, au-dessus — un <a> ne peut pas en contenir un autre.
//
// Données réelles uniquement : un prestataire n'apparaît ici que s'il est listé (identité
// vérifiée, compte actif — src/lib/profile-visibility.ts), d'où le badge d'identité constant.

// Ré-exporté pour les imports existants (propositions, devis).
export { countryFlag };

export type PersonCardProps = {
  name: string;
  countryCode?: string | null;
  avatarSrc?: string | null;
  initials: string;
  /** Filière (« Artisan », « Expert digital »…) — étiquette en haut de carte. */
  roleLabel: string;
  /** Métier principal déclaré — titre de la carte ; repli sur la filière. */
  domain?: string | null;
  city?: string | null;
  /** Note moyenne réelle (Review), null si aucun avis — jamais fabriquée. */
  rating?: number | null;
  reviewCount?: number;
  /** « 15 000 FCFA / jour » — null si aucun tarif indicatif déclaré (jamais inventé). */
  priceLabel?: string | null;
  href: string;
  ctaLabel?: string;
  className?: string;
};

export function PersonCard({
  name,
  countryCode,
  avatarSrc,
  initials,
  roleLabel,
  domain,
  city,
  rating,
  reviewCount,
  priceLabel,
  href,
  ctaLabel = "Voir le profil",
  className = "",
}: PersonCardProps) {
  const country = countryCode ? (countryName(countryCode) ?? countryCode) : null;

  return (
    <div
      className={`group relative h-full flex flex-col rounded-xl bg-[#F7F7F5] border border-transparent p-5 hover:border-[#FF6B35]/40 hover:bg-white hover:shadow-sm transition ${className}`}
    >
      <span className="self-start rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-[#0A1931] truncate max-w-full">
        {roleLabel}
      </span>
      <h3 className="mt-3 text-[17px] font-semibold leading-snug text-[#0A1931] group-hover:text-[#E85A24] transition line-clamp-2">
        <Link
          href={href}
          className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none"
          style={{ textDecoration: "none", color: "inherit" }}
        >
          {domain || roleLabel}
        </Link>
      </h3>

      <div className="mt-3 flex items-center gap-2.5 min-w-0">
        <Avatar src={avatarSrc} initials={initials} size={32} className="shrink-0" />
        <span className="text-[13px] font-medium text-[#0A1931] truncate">{name}</span>
        {countryCode && (
          <span role="img" aria-label={country ?? undefined} title={country ?? undefined} className="text-[16px] leading-none shrink-0">
            {countryFlag(countryCode)}
          </span>
        )}
        <span className="shrink-0 rounded-full bg-[#E8F5EE] px-2 py-0.5 text-[11px] font-semibold text-[#008751]">
          ✓ Identité vérifiée
        </span>
      </div>

      <p className="mt-2 text-[13px] text-gray-500">
        {city && <>{city} · </>}
        {rating != null ? (
          <>
            <span className="text-[#F7C948]">★</span> {rating.toFixed(1)}
            {reviewCount != null && ` (${reviewCount} avis)`}
          </>
        ) : (
          "Nouveau"
        )}
      </p>

      <div className="mt-auto pt-4 flex items-center justify-between gap-3">
        <span className="text-[15px] font-semibold text-[#0A1931]">
          {priceLabel ? (
            <>
              <span className="text-[12px] font-normal text-gray-500">À partir de </span>
              {priceLabel}
            </>
          ) : (
            "Sur devis"
          )}
        </span>
        <Link
          href={href}
          aria-label={`${ctaLabel} — ${name}`}
          className="relative z-10 shrink-0 rounded-lg bg-[#FF6B35] hover:bg-[#E85A24] px-4 py-2 text-[13px] font-semibold text-white transition"
          style={{ textDecoration: "none" }}
        >
          {ctaLabel}
        </Link>
      </div>
    </div>
  );
}
