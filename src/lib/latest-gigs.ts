import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PROVIDER_ROLE_LABEL, providerDisplayName, providerInitials } from "@/lib/provider-display";

// Derniers services (Gigs) publiés, pour la page d'accueil (2026-11-03) — pendant de
// latest-missions.ts.
//
// Mise en avant : les prestataires titulaires du badge « Vérifié » (un de leurs profils au
// statut `accorde`, instruit par l'Admin KYC) passent d'abord, du plus récent au plus ancien ;
// les autres complètent la liste, dans le même ordre. Critère publié et vérifiable — aucun
// épinglage à la main (règle de conformité n°5, voir TalentsAfrique.tsx).
//
// Seuls les prestataires LISTABLES apparaissent (identité vérifiée, compte actif), comme dans
// « Talents à la une » : publier un Gig exige le KYC, mais un KYC révoqué ensuite laisserait
// sinon le Gig en vitrine.

export type LatestGig = {
  id: string;
  titre: string;
  domaine: string;
  prixLabel: string;
  delaiJours: number;
  createdAt: Date;
  commandes: number;
  /** Gig à trois formules (2026-11-08) : le prix affiché est celui de la Basique, « à partir de ». */
  hasPackages: boolean;
  provider: { id: string; name: string; initials: string; avatarSrc: string | null; badgeVerified: boolean; country: string | null };
};

const BADGE: Prisma.ProfileListRelationFilter = { some: { badgeStatus: "accorde" } };

/** NE LÈVE JAMAIS : une base indisponible masque la section, pas la page d'accueil. */
export async function getLatestGigs(limit = 6): Promise<LatestGig[]> {
  try {
    const listable = { kycStatus: "verifie", status: "active" } as const;
    const query = (provider: Prisma.UserWhereInput, take: number) =>
      prisma.gig.findMany({
        where: { status: "publie", provider: { ...listable, ...provider } },
        orderBy: { createdAt: "desc" },
        take,
        select: {
          id: true,
          titre: true,
          domaine: true,
          prix: true,
          currency: true,
          delaiJours: true,
          createdAt: true,
          _count: { select: { orders: true, packages: true } },
          provider: { select: { id: true, firstname: true, lastname: true, avatarPath: true, country: true } },
        },
      });

    const badged = await query({ profiles: BADGE }, limit);
    const others = badged.length < limit ? await query({ profiles: { none: { badgeStatus: "accorde" } } }, limit - badged.length) : [];

    return [...badged.map((g) => [g, true] as const), ...others.map((g) => [g, false] as const)].map(([g, badgeVerified]) => ({
      id: g.id,
      titre: g.titre,
      // Le domaine d'un Gig est un libellé libre ; certains portent la filière du prestataire
      // (« expert_digital ») au lieu d'un métier — on l'affiche alors sous son nom lisible.
      domaine: PROVIDER_ROLE_LABEL[g.domaine] ?? g.domaine,
      prixLabel: `${g.prix.toLocaleString("fr-FR")} ${g.currency}`,
      delaiJours: g.delaiJours,
      createdAt: g.createdAt,
      commandes: g._count.orders,
      hasPackages: g._count.packages > 0,
      provider: {
        id: g.provider.id,
        name: providerDisplayName(g.provider),
        initials: providerInitials(g.provider),
        // Même route que les talents : l'avatar n'est servi que pour un compte listable.
        avatarSrc: g.provider.avatarPath ? `/api/users/${g.provider.id}/avatar` : null,
        badgeVerified,
        country: g.provider.country ?? null,
      },
    }));
  } catch {
    return [];
  }
}
