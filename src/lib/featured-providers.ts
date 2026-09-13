import { prisma } from "@/lib/db";
import type { UserRole } from "@prisma/client";

const PROVIDER_ROLES: UserRole[] = ["expert_digital", "expert_btp_autres", "artisan", "manoeuvre"];

export type FeaturedProvider = {
  id: string;
  role: string;
  firstname: string | null;
  lastname: string | null;
  avatarPath: string | null;
  country: string | null;
  mainDomain: string | null;
  zoneVille: string | null;
  indicativeRate: number | null;
  tarifUnite: string | null;
  averageRating: number | null;
  reviewCount: number;
};

// Prestataires mis en avant sur la page d'accueil publique. Mêmes règles d'éligibilité que
// /api/search/prestataires (identité vérifiée + au moins un profil), pour qu'un visiteur ne
// puisse pas voir en vitrine un profil qui n'apparaîtrait pas dans la recherche.
//
// Classement : les mieux notés d'abord, puis les plus récents. Aucune notion de mise en
// avant payante — /recherche affiche « aucun critère commercial caché n'est appliqué », la
// page d'accueil doit tenir la même promesse.
//
// La note et le nombre d'avis sont calculés depuis Review (suspendu:false) et valent null/0
// tant qu'aucun avis n'existe : PersonCard masque alors la ligne d'étoiles plutôt que
// d'afficher une note fabriquée.
export async function getFeaturedProviders(limit = 4): Promise<FeaturedProvider[]> {
  const providers = await prisma.user.findMany({
    where: {
      kycStatus: "verifie",
      role: { in: PROVIDER_ROLES },
      profiles: { some: {} },
    },
    include: { profiles: true },
    orderBy: { createdAt: "desc" },
  });

  const ratings = await prisma.review.groupBy({
    by: ["targetId"],
    where: { targetId: { in: providers.map((p) => p.id) }, suspendu: false },
    _avg: { note: true },
    _count: { note: true },
  });
  const byProvider = new Map(ratings.map((r) => [r.targetId, r]));

  return providers
    .map((p) => {
      const profile = p.profiles.find((pf) => pf.isDefault) ?? p.profiles[0];
      const agg = byProvider.get(p.id);
      return {
        id: p.id,
        role: p.role,
        firstname: p.firstname,
        lastname: p.lastname,
        avatarPath: p.avatarPath,
        country: p.country,
        mainDomain: profile?.mainDomain ?? null,
        zoneVille: profile?.zoneVille ?? null,
        indicativeRate: profile?.indicativeRate ?? null,
        tarifUnite: profile?.tarifUnite ?? null,
        averageRating: agg?._avg.note ?? null,
        reviewCount: agg?._count.note ?? 0,
      };
    })
    .sort((a, b) => (b.averageRating ?? -1) - (a.averageRating ?? -1))
    .slice(0, limit);
}
