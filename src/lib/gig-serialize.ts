import type { Gig, GigPackage } from "@prisma/client";
import { sortPackages, videoEmbedUrl } from "@/lib/gig-rules";

// Forme d'un Gig renvoyée par les routes (catalogue, détail, profil public, gestion) —
// une seule, pour que l'éditeur, le catalogue et le profil lisent les mêmes champs.

export type GigPackageView = {
  tier: "basique" | "standard" | "premium";
  titre: string;
  description: string;
  prix: number;
  delaiJours: number;
  revisions: number;
};

export type GigView = {
  id: string;
  titre: string;
  description: string;
  domaine: string;
  currency: string;
  tags: string[];
  status: string;
  createdAt: Date;
  updatedAt: Date;
  /** Prix « à partir de » : formule Basique, ou prix unique d'un Gig antérieur aux formules. */
  prixDepart: number;
  delaiJours: number;
  packages: GigPackageView[];
  /** Première photo (couverture), ou null. */
  coverUrl: string | null;
  /** Toutes les photos, dans l'ordre (3 au plus) — le carrousel des cartes. */
  images: string[];
  videoUrl: string | null;
  videoEmbedUrl: string | null;
};

export const gigImageUrl = (gigId: string, index: number, updatedAt: Date) =>
  `/api/gigs/${gigId}/images/${index}?v=${updatedAt.getTime()}`;

export function serializeGig(g: Gig & { packages?: GigPackage[] }): GigView {
  const packages = sortPackages(g.packages ?? []).map((p) => ({
    tier: p.tier,
    titre: p.titre,
    description: p.description,
    prix: p.prix,
    delaiJours: p.delaiJours,
    revisions: p.revisions,
  }));
  return {
    id: g.id,
    titre: g.titre,
    description: g.description,
    domaine: g.domaine,
    currency: g.currency,
    tags: g.tags,
    status: g.status,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    prixDepart: packages[0]?.prix ?? g.prix,
    delaiJours: packages[0]?.delaiJours ?? g.delaiJours,
    packages,
    // Cache-busting par `updatedAt` : une photo remplacée ou réordonnée ne reste pas masquée par
    // l'ancienne version en cache (l'URL est indexée par position).
    coverUrl: g.imagePaths.length ? gigImageUrl(g.id, 0, g.updatedAt) : null,
    images: g.imagePaths.map((_, i) => gigImageUrl(g.id, i, g.updatedAt)),
    videoUrl: g.videoUrl,
    videoEmbedUrl: videoEmbedUrl(g.videoUrl),
  };
}
