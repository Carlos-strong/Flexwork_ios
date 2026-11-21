import { prisma } from "@/lib/db";

// Profil « principal » d'un utilisateur (2026-09-23) — un seul point de vérité pour un
// aiguillage qui était recopié partout.
//
// Depuis le passage multi-profils (2026-08-06), `Profile` n'a plus de contrainte unique sur
// `userId` seul : `findUnique({ where: { userId } })` ne compile plus, et chaque route
// contournait le problème avec son propre `findFirst({ where: { userId } })` — sans tri. Un
// `findFirst` sans `orderBy` ne garantit RIEN : PostgreSQL peut rendre le profil secondaire
// aujourd'hui et le principal demain, et l'écran afficherait alors un autre métier que celui
// qu'on vient d'enregistrer.
//
// Le tri est explicite : `isDefault` d'abord, puis `id` (cuid, donc croissant avec la
// création) pour que le résultat soit déterministe même entre deux profils non par défaut.
export function findPrimaryProfile(userId: string) {
  return prisma.profile.findFirst({
    where: { userId },
    orderBy: [{ isDefault: "desc" }, { id: "asc" }],
  });
}

// Compétences, expériences et diplômes d'un profil viennent de ses DÉCLARATIONS, pas du
// profil lui-même : une déclaration retirée ne compte plus, et une correction crée une
// nouvelle déclaration sans effacer l'ancienne. Compter sur `profile.declarations` sans
// filtrer `removedAt` gonflerait le pourcentage de complétion avec du contenu que
// l'utilisateur a explicitement retiré.
export async function countProfileDeclarations(profileId: string): Promise<{
  experiencesCount: number;
  diplomasCount: number;
}> {
  const [experiencesCount, diplomasCount] = await Promise.all([
    prisma.declaredExperience.count({
      where: { declaration: { profileId, removedAt: null } },
    }),
    prisma.declaredDiploma.count({
      where: { declaration: { profileId, removedAt: null } },
    }),
  ]);
  return { experiencesCount, diplomasCount };
}
