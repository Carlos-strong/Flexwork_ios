import type { UserRole } from "@prisma/client";

// A13 (etat-consolide-Flexwork.md §2) — plancher impératif, non administrable :
// minimum_age >= 18 sur toute filière chantier, sans exception. L'interface d'admin doit
// refuser toute valeur inférieure, jamais un simple garde-fou côté UI.
export const ABSOLUTE_MINIMUM_AGE = 18;

// Rôles qui déclenchent l'exigence de GARANT (activée compte par compte par l'Admin KYC) et
// l'affichage « filière chantier » côté administration.
//
// ⚠️ Depuis le 2026-09-24, cette liste ne gouverne plus la BARRIÈRE D'ÂGE : celle-ci se
// déclenche sur la CATÉGORIE du métier (`Categorie.requiresAgeCheck`), parce que la filière dit
// comment on exerce, pas quel travail on fait. La conserver ici pour le garant et l'affichage
// est volontaire — ce sont deux règles distinctes qui se trouvaient coïncider.
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
// La règle « qui est concerné » n'est PAS ici : elle dépend de la catégorie du métier, lue en
// base (voir `isCategorieAgeOk`). Cette fonction ne répond qu'à une question : une date de
// naissance connue satisfait-elle le seuil ?
export function isMinimumAgeSatisfied(params: {
  dateNaissance: Date | null;
  minimumAge: number | null; // null = aucune règle par pays trouvée -> plancher légal
  now?: Date;
}): boolean {
  if (!params.dateNaissance) return false; // date non relevée par le KYC

  const threshold = params.minimumAge ?? ABSOLUTE_MINIMUM_AGE;
  const age = computeAge(params.dateNaissance, params.now);
  return age >= threshold;
}
