import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import type { AdminRole } from "@prisma/client";

export async function requireAdmin() {
  const session = await auth();
  if (!session?.user) return { error: "unauthenticated" as const, status: 401 as const };

  const userId = (session.user as typeof session.user & { id: string }).id;
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !user.isAdmin) {
    return { error: "forbidden" as const, status: 403 as const };
  }

  return { user };
}

// Séparation des pouvoirs administratifs (modele-skillafrica-v3-Flexwork.md §13) : au-delà
// du flag `isAdmin`, chaque route sensible exige le rôle précis (kyc/moderation/mediation/
// superviseur) — un admin générique sans rôle assigné ne peut rien faire de sensible.
export async function requireAdminRole(role: AdminRole) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard;

  if (guard.user.adminRole !== role) {
    return { error: "forbidden_wrong_admin_role" as const, status: 403 as const };
  }

  return guard;
}

// Lecture partagée entre plusieurs rôles (2026-09-15) — le suivi des flux financiers intéresse
// le Superviseur (il lit tout, §13) ET la Médiation (elle arbitre les fonds). Les GESTES restent
// gardés par un rôle unique via `requireAdminRole` : lire n'est pas agir.
export async function requireAnyAdminRole(roles: AdminRole[]) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard;

  if (!guard.user.adminRole || !roles.includes(guard.user.adminRole)) {
    return { error: "forbidden_wrong_admin_role" as const, status: 403 as const };
  }

  return guard;
}
