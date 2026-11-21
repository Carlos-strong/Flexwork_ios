import type { Secteur } from "@prisma/client";

// Secteur de la marketplace (2026-09-28) — les trois pôles DIGITAL / BTP / SERVICES qui
// regroupent les catégories de la taxonomie (`Categorie.secteur`).
//
// Classement posé par l'administrateur, jamais déduit : une catégorie sans secteur est « non
// classée », et s'affiche comme telle — pas rangée d'office dans « Services » parce qu'elle ne
// ressemble à rien d'autre.
//
// Le secteur dit QUEL travail (il regroupe des catégories), pas COMMENT on l'exerce : il est
// indépendant de la filière du compte (`User.role` — indépendant, entreprise, artisan, manœuvre).
// Un électricien artisan et une entreprise d'électricité relèvent du même secteur.

// Liste répétée depuis l'enum Prisma : un `z.enum` ou un contrôle de saisie a besoin de
// littéraux, pas d'un type effacé à la compilation.
export const SECTEUR_VALUES = ["digital", "btp", "services"] as const;

export function isSecteur(value: unknown): value is Secteur {
  return typeof value === "string" && (SECTEUR_VALUES as readonly string[]).includes(value);
}

export const SECTEURS: { value: Secteur; label: string; hint: string }[] = [
  { value: "digital", label: "Digital", hint: "Informatique, communication, conseil — souvent à distance." },
  { value: "btp", label: "BTP", hint: "Construction, second œuvre, chantier — travail sur site." },
  { value: "services", label: "Services", hint: "Services aux particuliers et aux entreprises hors chantier." },
];

export const SECTEUR_NON_CLASSE = "Non classée";

export function secteurLabel(secteur: string | null | undefined): string {
  return SECTEURS.find((s) => s.value === secteur)?.label ?? SECTEUR_NON_CLASSE;
}

/**
 * Lecture d'un `secteur` reçu par l'API d'administration.
 *   - clé absente (`undefined`) → `{ ok: true, value: undefined }` : laisser la colonne intacte ;
 *   - `null` ou `""`            → `{ ok: true, value: null }` : déclasser explicitement ;
 *   - valeur connue             → `{ ok: true, value }` ;
 *   - autre chose               → refus, jamais un repli silencieux sur « non classée ».
 */
export function parseSecteurInput(
  raw: unknown,
): { ok: true; value: Secteur | null | undefined } | { ok: false } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || raw === "") return { ok: true, value: null };
  return isSecteur(raw) ? { ok: true, value: raw } : { ok: false };
}

// ── Types de professionnel admis par secteur (2026-09-28) ────────────────────────────────────
// Cohérence de la DESCRIPTION d'une mission, pas règle d'éligibilité (A16) : une mission du
// secteur Digital ne peut pas CIBLER un artisan ou un manœuvre (`Mission.professionalType`,
// préférence du client). Aucun prestataire n'est exclu de candidater par cette table — elle ne
// sert qu'au formulaire de publication et à la validation de POST /api/missions.
//
// Valeurs = celles de `Mission.professionalType` (EXPERT_DIGITAL = Prestataire indépendant,
// EXPERT_BTP = Entreprise). Une constante suffit : trois secteurs, fixés par l'enum.
export const PROFESSIONAL_TYPE_VALUES = ["EXPERT_DIGITAL", "EXPERT_BTP", "ARTISAN", "MANOEUVRE"] as const;

const PROFESSIONAL_TYPES_BY_SECTEUR: Record<Secteur, readonly string[]> = {
  digital: ["EXPERT_DIGITAL", "EXPERT_BTP"],
  btp: PROFESSIONAL_TYPE_VALUES,
  services: PROFESSIONAL_TYPE_VALUES,
};

/**
 * Types de professionnel qu'une mission de ce secteur peut cibler. Catégorie non classée
 * (`null`) ou secteur inconnu → aucune restriction : l'absence de classement ne doit jamais
 * fermer un choix.
 */
export function allowedProfessionalTypes(secteur: string | null | undefined): readonly string[] {
  return isSecteur(secteur) ? PROFESSIONAL_TYPES_BY_SECTEUR[secteur] : PROFESSIONAL_TYPE_VALUES;
}

/** « Indifférent » (vide) est toujours admis. */
export function isProfessionalTypeAllowed(
  secteur: string | null | undefined,
  professionalType: string | null | undefined,
): boolean {
  return !professionalType || allowedProfessionalTypes(secteur).includes(professionalType);
}
