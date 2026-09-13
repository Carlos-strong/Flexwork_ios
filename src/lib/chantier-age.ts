import { prisma } from "@/lib/db";
import type { UserRole } from "@prisma/client";
import { isChantierRole, isChantierProfileAllowed } from "@/lib/age-gate";

// A13 — décision arbitrée (dual-role, point 03 du plan) : le contrôle d'âge porte sur la
// FILIÈRE PRESTATAIRE (ce que la personne OFFRE : artisan, manœuvre, expert BTP), jamais
// sur le compte. Conséquences pour un compte à double face (client + manœuvre) :
//   - côté client : jamais soumis au seuil (hors sujet) ;
//   - côté prestataire : le seuil s'applique, sans esquisse possible.
// Dans l'architecture actuelle (rôle unique au signup), la filière prestataire == user.role ;
// sous dual-role, elle restera la filière du profil prestataire, pas la face du compte.
//
// Module unique (R03) : la lecture de countryAgeRequirement + l'évaluation sont centralisées
// ici et réutilisées par l'activation du profil (POST /api/profile) et par la candidature
// (src/lib/candidature-guard.ts) — un mineur ne peut ni activer son profil chantier, ni
// candidater à une mission chantier.
export type ChantierAgeResult =
  | { ok: true }
  | { ok: false; reason: "no_birth_date" | "under_minimum_age" };

export async function isChantierPrestataireAgeOk(params: {
  role: UserRole;
  country: string | null;
  dateNaissance: Date | null;
}): Promise<ChantierAgeResult> {
  // Hors filière chantier → aucun contrôle (le côté client d'un compte n'est jamais soumis).
  if (!isChantierRole(params.role)) return { ok: true };

  // Seuil administré par pays pour cette filière (règle générale, pas spécifique à un
  // domaine), sinon plancher légal absolu de 18 ans.
  const requirement = await prisma.countryAgeRequirement.findFirst({
    where: { country: params.country ?? "", profileType: params.role, domain: null },
  });

  const allowed = isChantierProfileAllowed({
    role: params.role,
    dateNaissance: params.dateNaissance,
    minimumAge: requirement?.minimumAge ?? null,
  });
  if (!allowed) {
    return {
      ok: false,
      reason: params.dateNaissance ? "under_minimum_age" : "no_birth_date",
    };
  }
  return { ok: true };
}
