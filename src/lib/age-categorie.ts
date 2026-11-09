import { prisma } from "@/lib/db";
import type { UserRole } from "@prisma/client";
import { isMinimumAgeSatisfied } from "@/lib/age-gate";

// A13 — la barrière d'âge est portée par la CATÉGORIE du métier (2026-09-24).
//
// Elle s'évaluait sur la FILIÈRE du compte (`UserRole` : artisan, manœuvre,
// expert_btp_autres). Deux raisons de la déplacer :
//
//   1. La filière dit COMMENT on exerce, pas QUEL travail on fait. Depuis que « Prestataire
//      indépendant » a remplacé « Expert digital », elle ne délimite plus rien : un électricien
//      pouvait s'y déclarer et n'être jamais soumis au contrôle d'âge.
//   2. La catégorie est l'axe qui dit réellement le travail — c'est aussi elle que le client
//      choisit en publiant une mission, donc les deux côtés se répondent au lieu de se croiser.
//
// Le déclencheur est un marqueur posé par l'administrateur sur la catégorie
// (`Categorie.requiresAgeCheck`), comme le palier de risque l'est sur le métier. Il n'est posé
// nulle part à l'installation : tant que personne ne l'a coché, la barrière ne se dresse pas.
// C'est un choix de classification, pas un oubli.
//
// Module unique (R03) : l'évaluation vit ici et sert aux deux moments où le travail est choisi —
// l'enregistrement du métier dans le profil (POST /api/profile) et la candidature à une mission
// (src/lib/candidature-guard.ts). Un mineur ne peut donc ni déclarer un métier d'une catégorie
// protégée, ni candidater sur une mission de cette catégorie.
export type AgeGateResult =
  | { ok: true }
  | { ok: false; reason: "no_birth_date" | "under_minimum_age" };

export async function isCategorieAgeOk(params: {
  /**
   * Catégorie du métier concerné — celle du métier déclaré dans le profil, ou celle de la
   * mission visée. `null` (métier non choisi, domaine textuel libre) = rien à classifier, donc
   * rien à contrôler.
   */
  categorieId: string | null;
  /**
   * Sert au SEUIL, jamais à l'applicabilité. Les règles par pays sont saisies par filière
   * (`CountryAgeRequirement.profileType`), et cette granularité reste utile — un manœuvre et un
   * expert BTP peuvent avoir des seuils différents. Une filière sans règle configurée retombe
   * sur le plancher légal de 18 ans, jamais sur « pas de contrôle ».
   */
  role: UserRole;
  country: string | null;
  dateNaissance: Date | null;
}): Promise<AgeGateResult> {
  if (!params.categorieId) return { ok: true };

  const categorie = await prisma.categorie.findUnique({
    where: { id: params.categorieId },
    select: { requiresAgeCheck: true },
  });
  if (!categorie?.requiresAgeCheck) return { ok: true };

  const requirement = await prisma.countryAgeRequirement.findFirst({
    where: { country: params.country ?? "", profileType: params.role, domain: null },
  });

  const satisfied = isMinimumAgeSatisfied({
    dateNaissance: params.dateNaissance,
    minimumAge: requirement?.minimumAge ?? null,
  });

  // La distinction entre les deux refus reste tenue : un âge INCONNU n'est pas un âge
  // insuffisant, et les deux ne se réparent pas de la même façon (dossier d'identité contre
  // attente de l'anniversaire).
  return satisfied
    ? { ok: true }
    : { ok: false, reason: params.dateNaissance ? "under_minimum_age" : "no_birth_date" };
}
