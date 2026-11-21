import { prisma } from "@/lib/db";
import { cleanSpecialty, normalizeSpecialty } from "@/lib/qualification-catalog";

// Registre partagé des spécialités de diplômes (modèle QualificationSpecialty, 2026-11-07).

/**
 * Ajoute au registre les spécialités des titres qui viennent d'être déclarés. Idempotent :
 * une spécialité déjà connue (même clé normalisée) est laissée telle quelle — y compris son
 * domaine d'origine —, si bien que redéclarer la liste entière des diplômes ne crée rien.
 *
 * Volontairement « au mieux » : appelée APRÈS que la déclaration est scellée, elle ne doit
 * jamais la faire échouer. Un domaine inconnu est ignoré plutôt que de violer la clé étrangère.
 */
export async function recordQualificationSpecialties(
  items: { specialty?: string | null; categorieId?: string | null }[],
): Promise<void> {
  const byKey = new Map<string, { libelle: string; categorieId: string | null }>();
  for (const item of items) {
    const libelle = cleanSpecialty(item.specialty);
    const normalized = normalizeSpecialty(libelle);
    if (!normalized || byKey.has(normalized)) continue;
    byKey.set(normalized, { libelle, categorieId: item.categorieId || null });
  }
  if (byKey.size === 0) return;

  const ids = Array.from(new Set(Array.from(byKey.values()).map((v) => v.categorieId).filter((x): x is string => !!x)));
  const known = new Set(
    ids.length ? (await prisma.categorie.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((c) => c.id) : [],
  );

  for (const [normalized, { libelle, categorieId }] of byKey) {
    try {
      await prisma.qualificationSpecialty.upsert({
        where: { normalized },
        create: { libelle, normalized, categorieId: categorieId && known.has(categorieId) ? categorieId : null },
        update: {},
      });
    } catch (err) {
      console.error("[qualification-specialties] enregistrement impossible :", normalized, err);
    }
  }
}

/** Spécialités connues, pour les suggestions de l'onglet Expérience. */
export async function listQualificationSpecialties(): Promise<{ libelle: string; categorieId: string | null }[]> {
  return prisma.qualificationSpecialty.findMany({
    select: { libelle: true, categorieId: true },
    orderBy: { libelle: "asc" },
    take: 2000,
  });
}
