import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { findPrimaryProfile, countProfileDeclarations } from "@/lib/profile-query";
import { computeProviderProfileCompletion } from "@/lib/provider-profile-completion";

export const dynamic = "force-dynamic";

// GET /api/profile/completion (2026-09-23) — pourcentage de complétion du profil prestataire.
//
// Calculé À LA VOLÉE, jamais stocké : aucune colonne `completionPercent`, aucun job de
// recalcul. Un chiffre stocké finit toujours par mentir — une déclaration retirée, une photo
// supprimée, un domaine changé ne repasseraient par aucun recalcul, et le tableau de bord
// afficherait un score que plus rien ne justifie. Le coût d'un calcul en lecture est de deux
// `count` et d'une lecture de profil.
//
// Le calcul lui-même vit dans `src/lib/provider-profile-completion.ts` : c'est une fonction
// pure, testée seule, et c'est le SERVEUR qui tranche le pourcentage — l'UI ne le recalcule
// jamais de son côté, sinon deux barèmes divergeraient à la première évolution.

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const [user, profile] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      // `avatarPath` vient de User, pas de Profile : la photo sert aux deux rôles et est
      // stockée une seule fois.
      select: { avatarPath: true, isProvider: true },
    }),
    findPrimaryProfile(userId),
  ]);

  // Pas encore de profil : la réponse n'est pas une 404. Un compte fraîchement promu
  // prestataire n'a rien enregistré, et l'écran a besoin de savoir QUOI afficher (0 %, avec
  // tout ce qui manque) plutôt que de tomber sur une erreur et de n'afficher rien du tout.
  const counts = profile ? await countProfileDeclarations(profile.id) : { experiencesCount: 0, diplomasCount: 0 };

  const completion = computeProviderProfileCompletion({
    providerKind: profile?.providerKind,
    avatarPath: user?.avatarPath,
    title: profile?.title,
    description: profile?.description,
    mainDomain: profile?.mainDomain,
    tags: profile?.tags,
    declaredExperienceYears: profile?.declaredExperienceYears,
    experiencesCount: counts.experiencesCount,
    diplomasCount: counts.diplomasCount,
    zonePays: profile?.zonePays,
    zoneVille: profile?.zoneVille,
    zoneRayonKm: profile?.zoneRayonKm,
    availability: profile?.availability,
    tarifUnite: profile?.tarifUnite,
  });

  return NextResponse.json({
    ...completion,
    hasProfile: Boolean(profile),
    isProvider: user?.isProvider ?? false,
  });
}
