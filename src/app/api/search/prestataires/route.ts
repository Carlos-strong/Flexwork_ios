import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import type { UserRole } from "@prisma/client";

const PROVIDER_ROLES: UserRole[] = ["expert_digital", "expert_btp_autres", "artisan", "manoeuvre"];

// Recherche de prestataires par domaine, rôle, tags et zone. Modèle v3 : aucune
// vérification de qualification ne conditionne l'apparition dans les résultats — seul le
// KYC (identité) est un fait vérifié par la plateforme, tout le reste (déclarations) est
// affiché tel quel côté profil, pas filtré ici comme un critère de "qualité".
//
// Route PUBLIQUE (2026-09-09) : la barre de recherche de la navbar et /recherche doivent
// fonctionner pour un visiteur non connecté — c'est la porte d'entrée du site. En
// contrepartie la réponse n'expose PAS l'email des prestataires (elle le faisait tant que
// la route était derrière une session) : un annuaire public d'emails vérifiés est une cible
// de collecte automatisée. Le contact passe par la plateforme, pas par la page de résultats.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const domaine = searchParams.get("domaine");
  const role = searchParams.get("role");
  const tagsParam = searchParams.get("tags");
  const pays = searchParams.get("pays");   // filtre zone: pays du profil

  const roleFilter: UserRole[] =
    role && PROVIDER_ROLES.includes(role as UserRole) ? [role as UserRole] : PROVIDER_ROLES;

  const tagsFilter = tagsParam
    ? tagsParam.split(",").map((t) => t.trim()).filter(Boolean)
    : null;

  // Filtrage zone : un prestataire est éligible si sa zonePays = pays demandé,
  // OU s'il n'a pas défini de zonePays (partout), OU si le paramètre pays est absent.
  //
  // `domaine` est OPTIONNEL depuis l'ouverture publique : absent, on liste tous les
  // prestataires vérifiés (c'est le mode « parcourir l'annuaire » de la navbar). Présent, la
  // correspondance est désormais partielle et insensible à la casse plutôt qu'une égalité
  // stricte — un visiteur tape « design » dans la navbar, pas la valeur exacte du champ
  // mainDomain saisie par le prestataire (ex. « Digital. »), et une égalité stricte ne
  // ramenait donc jamais rien depuis une recherche libre.
  const profileWhere: Record<string, unknown> = {};
  if (domaine) profileWhere.mainDomain = { contains: domaine, mode: "insensitive" };
  if (tagsFilter && tagsFilter.length > 0) profileWhere.tags = { hasSome: tagsFilter };
  if (pays) {
    profileWhere.OR = [
      { zonePays: pays },
      { zonePays: null },
    ];
  }

  const providers = await prisma.user.findMany({
    where: {
      kycStatus: "verifie",
      role: { in: roleFilter },
      profiles: { some: profileWhere },
    },
    include: { profiles: true },
  });

  // Note moyenne réelle par prestataire (Review, suspendu:false) — même agrégat que
  // /profil/[id] et la carte candidat du tiroir de /missions/[id]/proposals, pour que la
  // carte de résultat de recherche (profil.png) affiche une vraie note, jamais fabriquée.
  const providerIds = providers.map((p) => p.id);
  const reviews = await prisma.review.findMany({
    where: { targetId: { in: providerIds }, suspendu: false },
    select: { targetId: true, note: true },
  });
  const ratingsByProvider = new Map<string, number[]>();
  for (const r of reviews) {
    (ratingsByProvider.get(r.targetId) ?? ratingsByProvider.set(r.targetId, []).get(r.targetId)!).push(r.note);
  }

  return NextResponse.json({
    items: providers.map((p) => {
      // Même correspondance partielle que le filtre SQL ci-dessus, sinon un prestataire à
      // plusieurs profils remonté par `contains` se verrait afficher le profil par défaut
      // plutôt que celui qui a réellement matché la recherche.
      const needle = domaine?.toLowerCase();
      const profile =
        (needle ? p.profiles.find((pf) => pf.mainDomain?.toLowerCase().includes(needle)) : undefined) ??
        p.profiles.find((pf) => pf.isDefault) ??
        p.profiles[0];
      const ratings = ratingsByProvider.get(p.id);
      return {
        id: p.id,
        // Pas d'email : route publique — voir l'en-tête de fichier.
        role: p.role,
        firstname: p.firstname,
        lastname: p.lastname,
        avatarPath: p.avatarPath,
        country: p.country,
        mainDomain: profile?.mainDomain,
        declaredLevel: profile?.declaredLevel,
        tags: profile?.tags ?? [],
        tarifUnite: profile?.tarifUnite ?? null,
        indicativeRate: profile?.indicativeRate ?? null,
        zonePays: profile?.zonePays ?? null,
        zoneVille: profile?.zoneVille ?? null,
        zoneRayonKm: profile?.zoneRayonKm ?? null,
        averageRating: ratings?.length ? ratings.reduce((s, n) => s + n, 0) / ratings.length : null,
        reviewCount: ratings?.length ?? 0,
      };
    }),
  });
}
