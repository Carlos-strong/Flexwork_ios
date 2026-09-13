import { prisma } from "@/lib/db";
import type { Prisma, UserRole } from "@prisma/client";

const PROVIDER_ROLES: UserRole[] = ["expert_digital", "expert_btp_autres", "artisan", "manoeuvre"];

// Même critère d'éligibilité que getFeaturedProviders et /api/search/prestataires : identité
// vérifiée ET au moins un profil. Le KYC seul ne suffit pas — un compte vérifié sans profil
// n'apparaît ni dans l'annuaire ni en vitrine. Compter plus large ici ferait annoncer au
// visiteur « 2 talents vérifiés » sur un lien qui n'en affiche qu'un : un compteur doit
// décrire ce que la page de destination montre réellement, sinon il redevient un chiffre
// invérifiable comme ceux retirés du Hero.
const ELIGIBLE_PROVIDER: Prisma.UserWhereInput = {
  kycStatus: "verifie",
  role: { in: PROVIDER_ROLES },
  profiles: { some: {} },
};

export type PlatformStats = {
  /** Prestataires visibles dans l'annuaire — le seul « talent » que la plateforme peut attester. */
  verifiedProviders: number;
  /** Nombre de pays distincts renseignés par ces prestataires. */
  countries: number;
  /** Note moyenne réelle tous avis confondus, null tant qu'aucun avis n'existe. */
  averageRating: number | null;
  reviewCount: number;
  /** Missions menées jusqu'à la clôture. */
  completedMissions: number;
};

// Chiffres affichés sur la page d'accueil. Tous comptés en base, aucun n'est saisi à la
// main : la version précédente du Hero annonçait « 12 458 talents connectés », « 500K+
// talents dans 12 pays » et « 4.9/5 • 2 300+ avis », et TrustedBy « + 2 300 entreprises
// africaines » — des chiffres sans source, contredits par la base. Un compteur affiché doit
// pouvoir être recalculé ; s'il tombe à zéro, c'est l'appelant qui décide de masquer le
// bloc, pas ce module qui invente un plancher.
export async function getPlatformStats(): Promise<PlatformStats> {
  const [verifiedProviders, countryGroups, ratingAgg, completedMissions] = await Promise.all([
    prisma.user.count({ where: ELIGIBLE_PROVIDER }),
    prisma.user.groupBy({
      by: ["country"],
      where: { ...ELIGIBLE_PROVIDER, country: { not: null } },
    }),
    prisma.review.aggregate({ where: { suspendu: false }, _avg: { note: true }, _count: { note: true } }),
    prisma.mission.count({ where: { status: "cloturee" } }),
  ]);

  return {
    verifiedProviders,
    countries: countryGroups.length,
    averageRating: ratingAgg._avg.note,
    reviewCount: ratingAgg._count.note,
    completedMissions,
  };
}
