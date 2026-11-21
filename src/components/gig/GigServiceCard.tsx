"use client";

// Carte d'un service (Gig) — grille « Services » du profil public et catalogue (2026-11-08) :
// photos en carrousel en tête, domaine, titre « Je vais… », prix « à partir de ».
// Même famille visuelle que les cartes de l'accueil (fond #F7F7F5, bouton orange).

import Link from "next/link";
import type { ReactNode } from "react";
import { GigImageCarousel } from "@/components/gig/GigImageCarousel";

export function GigServiceCard({
  titre,
  domaine,
  coverUrl,
  images,
  prixDepart,
  currency,
  href,
  badge,
  footer,
}: {
  titre: string;
  domaine: string;
  coverUrl: string | null;
  /** Photos du service (3 au plus), en carrousel ; à défaut, `coverUrl` seule. */
  images?: string[];
  prixDepart: number;
  currency: string;
  /** Lien de la carte entière (profil public) ; absent pour une carte de gestion. */
  href?: string;
  badge?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white hover:shadow-md transition">
      {/* Photos en carrousel (3 au plus), AU-DESSUS du lien qui couvre la carte : flèches et
          points font défiler sans ouvrir le service ; la photo elle-même y mène. */}
      <div className="relative z-10 shrink-0">
        <GigImageCarousel
          images={images ?? (coverUrl ? [coverUrl] : [])}
          alt={titre}
          href={href}
          fallback={<div className="grid h-full place-items-center px-6 text-center text-[15px] font-semibold text-white/90">{domaine}</div>}
        />
        {badge && <div className="pointer-events-none absolute left-2 top-2 z-20">{badge}</div>}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <span className="self-start rounded-full bg-[#F6F5FA] px-2.5 py-1 text-[11px] font-semibold text-[#191224] truncate max-w-full">{domaine}</span>
        <h3 className="mt-2 text-[15px] font-semibold leading-snug text-[#191224] line-clamp-2 group-hover:text-[#5B21B6] transition">
          {href ? (
            <Link href={href} className="after:absolute after:inset-0 focus-visible:outline-none" style={{ textDecoration: "none", color: "inherit" }}>
              {titre}
            </Link>
          ) : (
            titre
          )}
        </h3>
        <div className="mt-auto pt-3 flex flex-wrap items-end justify-between gap-2">
          <p className="text-[12px] text-zinc-500">
            À partir de
            <span className="block text-[16px] font-bold text-[#191224]">
              {prixDepart.toLocaleString("fr-FR")} {currency}
            </span>
          </p>
          {footer && <div className="relative z-10">{footer}</div>}
        </div>
      </div>
    </div>
  );
}
