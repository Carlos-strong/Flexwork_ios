import type { Prisma, UserRole, UserStatus, KycStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { PROVIDER_ROLES } from "@/lib/provider-options";

// Qui peut voir le profil de qui (2026-11-08) — règle UNIQUE, partagée par la vitrine
// d'accueil, la recherche, les compteurs publics, /api/users/[id]/public-profile et les
// fichiers de portfolio.
//
// ── Ce que cette règle répare ───────────────────────────────────────────────────────────
//
// 1. Un compte SUSPENDU ou BANNI restait listé (vitrine « Talents d'Afrique », recherche) :
//    les critères ne regardaient que le KYC, le rôle et l'existence d'un profil. Une
//    sanction de modération doit retirer le compte de toute vitrine.
// 2. Tout utilisateur CONNECTÉ lisait le profil de N'IMPORTE QUEL compte en changeant l'id
//    de l'URL /profil/[id] — clients, comptes non vérifiés, comptes sanctionnés compris —
//    alors qu'un visiteur, lui, n'en voyait que les profils listés.
// 3. Les CV et photos de portfolio étaient servis à tout connecté sur simple chemin, y compris
//    après leur retrait par leur auteur.
//
// ── La règle ────────────────────────────────────────────────────────────────────────────
//
//   - profil LISTÉ (identité vérifiée, rôle prestataire, compte actif, au moins un profil) :
//     visible de tous ;
//   - sinon : visible seulement de son titulaire, d'un administrateur, ou d'un utilisateur
//     avec qui il partage une mission (candidature du prestataire à une mission du client,
//     dans un sens ou dans l'autre) — c'est le cas des liens « Voir profil » des
//     propositions et du devis ;
//   - un compte sanctionné n'est plus visible que de son titulaire et des administrateurs.
//
// Visibilité ne veut jamais dire écriture : toutes les routes de modification du profil
// (/api/profile/*) n'agissent que sur le compte de la session, jamais sur un id fourni.

/** Critère Prisma d'un prestataire listé publiquement. */
export const LISTED_PROVIDER_WHERE: Prisma.UserWhereInput = {
  kycStatus: "verifie",
  status: "active",
  role: { in: PROVIDER_ROLES },
  profiles: { some: {} },
};

export function isPubliclyListed(
  user: { kycStatus: KycStatus; status: UserStatus; role: UserRole; profileCount: number } | null,
): boolean {
  return (
    !!user &&
    user.kycStatus === "verifie" &&
    user.status === "active" &&
    PROVIDER_ROLES.includes(user.role) &&
    user.profileCount > 0
  );
}

/** Le lecteur et la cible partagent-ils une mission (candidature dans un sens ou l'autre) ? */
async function shareAMission(viewerId: string, targetId: string): Promise<boolean> {
  const link = await prisma.missionProposal.findFirst({
    where: {
      OR: [
        { providerId: targetId, mission: { clientId: viewerId } },
        { providerId: viewerId, mission: { clientId: targetId } },
      ],
    },
    select: { id: true },
  });
  return !!link;
}

export type Viewer = { id: string; isAdmin?: boolean } | null;

/**
 * Le lecteur peut-il voir ce profil ? `target` null (compte inexistant) → false : l'appelant
 * répond alors exactement comme pour un profil non autorisé, pour ne pas révéler qu'un id existe.
 */
export async function canViewProfile(
  viewer: Viewer,
  target: { id: string; kycStatus: KycStatus; status: UserStatus; role: UserRole; profileCount: number } | null,
): Promise<boolean> {
  if (!target) return false;
  if (viewer && (viewer.id === target.id || viewer.isAdmin)) return true;
  if (target.status !== "active") return false;
  if (isPubliclyListed(target)) return true;
  if (!viewer) return false;
  return shareAMission(viewer.id, target.id);
}

/** Lecture des champs utiles à `canViewProfile`. */
export async function loadVisibilityTarget(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    select: { id: true, kycStatus: true, status: true, role: true, _count: { select: { profiles: true } } },
  });
  return user ? { ...user, profileCount: user._count.profiles } : null;
}
