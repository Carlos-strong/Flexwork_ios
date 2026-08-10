import type { UserRole } from "@prisma/client";

// A13 (etat-consolide-Flexwork.md §2) — plancher impératif, non administrable :
// minimum_age >= 18 sur toute filière chantier, sans exception. L'interface d'admin doit
// refuser toute valeur inférieure, jamais un simple garde-fou côté UI.
export const ABSOLUTE_MINIMUM_AGE = 18;

// Rôles concernés par le contrôle d'âge — "filières chantier" au sens d'A13. Les autres
// rôles (client, expert_digital) ne sont jamais soumis à ce contrôle.
export const CHANTIER_ROLES: UserRole[] = ["artisan", "manoeuvre", "expert_btp_autres"];

export function isChantierRole(role: UserRole): boolean {
  return CHANTIER_ROLES.includes(role);
}

// Un seuil administré ne peut jamais descendre sous le plancher légal — configurable
// uniquement vers le haut (ex. 21 ans pour la conduite d'engins).
export function isValidMinimumAge(minimumAge: number): boolean {
  return Number.isInteger(minimumAge) && minimumAge >= ABSOLUTE_MINIMUM_AGE;
}

export function computeAge(dateNaissance: Date, now: Date = new Date()): number {
  let age = now.getFullYear() - dateNaissance.getFullYear();
  const hasHadBirthdayThisYear =
    now.getMonth() > dateNaissance.getMonth() ||
    (now.getMonth() === dateNaissance.getMonth() && now.getDate() >= dateNaissance.getDate());
  if (!hasHadBirthdayThisYear) age--;
  return age;
}

// Le contrôle est TOUJOURS recalculé en direct (jamais un statut figé stocké en base) :
// « Réévaluation automatique à l'anniversaire — un profil refusé à 17 ans s'active à 18 sans
// repasser le KYC. » (etat-consolide-Flexwork.md §2, A13).
export function isChantierProfileAllowed(params: {
  role: UserRole;
  dateNaissance: Date | null;
  minimumAge: number | null; // null = aucune règle par pays trouvée -> plancher légal par défaut
  now?: Date;
}): boolean {
  if (!isChantierRole(params.role)) return true;
  if (!params.dateNaissance) return false; // KYC (et donc la date de naissance) pas encore vérifié

  const threshold = params.minimumAge ?? ABSOLUTE_MINIMUM_AGE;
  const age = computeAge(params.dateNaissance, params.now);
  return age >= threshold;
}
