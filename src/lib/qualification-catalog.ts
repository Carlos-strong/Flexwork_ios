// Diplômes et certifications : niveaux proposés et spécialités saisies (2026-11-07).
//
// ── Le principe ─────────────────────────────────────────────────────────────────────────
//
// 1. Diplôme : le prestataire choisit un NIVEAU dans une liste fixe et courte (ci-dessous),
//    puis SAISIT sa spécialité. Intitulé enregistré : « BTS Génie civil ».
//    Certification : intitulé libre, spécialité facultative.
// 2. La spécialité saisie est ajoutée à la liste partagée `QualificationSpecialty` dès que le
//    titre est déclaré (POST /api/declarations) — elle revient en suggestion aux suivants.
//
// Cette version remplace un catalogue par pays (niveaux nationaux × spécialités de la
// taxonomie) jugé trop large : des dizaines d'intitulés générés, dont beaucoup n'existaient pas
// sous ce nom. Sept niveaux connus partout et une spécialité dans les mots du prestataire
// disent la même chose, plus juste.

export type QualificationKind = "diplome" | "certification";

export const DIPLOMA_LEVELS = [
  { value: "CAP", label: "CAP" },
  { value: "DT", label: "DT" },
  { value: "DUT", label: "DUT" },
  { value: "BTS", label: "BTS" },
  { value: "Licence professionnelle", label: "Licence professionnelle" },
  { value: "Ingénieur", label: "Ingénieur" },
  { value: "Master professionnel", label: "Master professionnel" },
] as const;

export type DiplomaLevel = (typeof DIPLOMA_LEVELS)[number]["value"];

export function isDiplomaLevel(value: string): value is DiplomaLevel {
  return DIPLOMA_LEVELS.some((l) => l.value === value);
}

/** Longueur maximale d'une spécialité (colonne `DeclaredDiploma.specialty`, schéma zod). */
export const SPECIALTY_MAX = 120;

/**
 * Graphie conservée d'une spécialité saisie : espaces superflus retirés, première lettre en
 * majuscule, le reste tel que tapé (« génie civil » → « Génie civil », « BTP » reste « BTP »).
 * Chaîne vide si rien d'exploitable.
 */
export function cleanSpecialty(raw: string | null | undefined): string {
  const s = (raw ?? "").replace(/\s+/g, " ").trim().slice(0, SPECIALTY_MAX);
  return s ? s.charAt(0).toLocaleUpperCase("fr-FR") + s.slice(1) : "";
}

/**
 * Clé d'unicité d'une spécialité : minuscules, sans accents ni ponctuation, espaces
 * normalisés. « Génie civil », « genie civil » et « GÉNIE  CIVIL. » donnent la même clé.
 */
export function normalizeSpecialty(raw: string | null | undefined): string {
  return cleanSpecialty(raw)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Intitulé enregistré pour un diplôme : « BTS Génie civil », « Ingénieur en Génie civil ». */
export function diplomaTitle(level: DiplomaLevel, specialty: string): string {
  const spec = cleanSpecialty(specialty);
  if (!spec) return level;
  return level === "Ingénieur" ? `Ingénieur en ${spec}` : `${level} ${spec}`;
}

/**
 * Suggestions de spécialités pour un domaine, sans doublon (clé normalisée) : d'abord celles
 * saisies dans ce domaine et les métiers du domaine, puis toutes les autres.
 */
export function specialtySuggestions(params: {
  categorieId: string | null | undefined;
  metiers: string[];
  saved: { libelle: string; categorieId: string | null }[];
}): string[] {
  const { categorieId, metiers, saved } = params;
  const inDomain = saved.filter((s) => categorieId && s.categorieId === categorieId).map((s) => s.libelle);
  const others = saved.filter((s) => !(categorieId && s.categorieId === categorieId)).map((s) => s.libelle);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of [...inDomain, ...metiers, ...others]) {
    const key = normalizeSpecialty(label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(cleanSpecialty(label));
  }
  return out;
}
