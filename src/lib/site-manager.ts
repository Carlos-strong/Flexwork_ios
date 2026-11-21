import { prisma } from "@/lib/db";

// Résolution d'un responsable de chantier à partir d'un e-mail ou d'un téléphone — partagée
// entre la publication (POST /api/missions, désignation facultative dès ce moment) et la route
// de désignation (PATCH /api/missions/[id]/site-manager, désignation plus tard).

export type SiteManagerResolution =
  | { ok: true; user: { id: string; firstname: string | null; lastname: string | null; email: string | null } }
  | { ok: false; error: "identifier_required" | "user_not_found" | "not_a_site_manager" | "invalid_site_manager"; status: number };

export async function resolveSiteManager(
  rawIdentifier: string,
  parties: { clientId: string; providerId: string | null }
): Promise<SiteManagerResolution> {
  const identifier = rawIdentifier.trim();
  if (!identifier) return { ok: false, error: "identifier_required", status: 400 };

  const candidat = await prisma.user.findFirst({
    where: identifier.includes("@") ? { email: identifier } : { tel: identifier },
    select: { id: true, role: true, status: true, firstname: true, lastname: true, email: true },
  });
  if (!candidat || candidat.status !== "active") return { ok: false, error: "user_not_found", status: 404 };
  // Seul un compte portant ce rôle peut être désigné : vérifier le travail qui sera payé n'est
  // pas un droit qu'on confie à un compte quelconque au détour d'un formulaire.
  if (candidat.role !== "responsable_chantier") return { ok: false, error: "not_a_site_manager", status: 409 };
  // Ni le prestataire (il vérifierait son propre travail), ni le client lui-même (il n'a pas à se
  // déléguer son propre pouvoir — c'est le mode « Moi-même »).
  if (candidat.id === parties.clientId || candidat.id === parties.providerId) {
    return { ok: false, error: "invalid_site_manager", status: 409 };
  }
  const { id, firstname, lastname, email } = candidat;
  return { ok: true, user: { id, firstname, lastname, email } };
}
