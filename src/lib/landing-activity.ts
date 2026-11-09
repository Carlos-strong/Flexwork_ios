import { cache } from "react";
import { prisma } from "@/lib/db";
import type { FrontendConfigItem } from "@/lib/frontend-config";
import { resolveLandingTarget, type LandingCategorie } from "@/lib/taxonomy-landing";

// Domaines de l'accueil classés par ACTIVITÉ (2026-11-03) — barre de catégories, grille de
// domaines et « Services populaires ».
//
// Ces trois blocs affichaient une liste éditoriale (/backoffice/content) dans l'ordre de
// l'éditeur, sans rapport avec ce qui est réellement publié : une mission « Couture » n'avait
// aucune entrée, pendant que « Code » ou « Vidéo », sans la moindre mission, tenaient la tête.
// Désormais :
//   1. chaque entrée éditoriale est rapprochée de la taxonomie (même règle que /recherche,
//      `resolveLandingTarget`) et reçoit le nombre de missions et de prestations (Gigs) publiées
//      dans sa catégorie ou son métier ;
//   2. les métiers actifs qu'aucune entrée ne couvre sont AJOUTÉS (« Couture ») ;
//   3. le tout est trié par activité décroissante. À égalité, l'entrée éditoriale passe avant
//      l'entrée ajoutée, et l'ordre de l'éditeur départage le reste — une base sans aucune
//      publication rend donc exactement la liste éditée.
// La longueur de la liste éditée est conservée : un ajout évince la dernière entrée sans
// activité plutôt que de déformer la grille.

/** Publications d'un même rattachement : missions `publiee` et Gigs `publie`. */
export type LandingActivity = { categorieId: string | null; metierId: string | null; domaine: string; count: number };

type Ranked = { item: FrontendConfigItem; score: number; added: boolean; order: number };

export function rankDomainsByActivity(
  items: FrontendConfigItem[],
  tree: LandingCategorie[],
  activity: LandingActivity[],
  termOf: (item: FrontendConfigItem) => string = (item) => item.label,
): FrontendConfigItem[] {
  if (items.length === 0) return items;

  // Rattachement de chaque publication. Les missions récentes portent leurs identifiants ; les
  // anciennes et les Gigs n'ont qu'un libellé libre, rapproché comme une recherche. Un libellé
  // sans correspondance (un Gig au domaine « expert_digital ») ne compte nulle part.
  const metierCategorie = new Map(tree.flatMap((c) => c.metiers.map((m) => [m.id, c.id] as const)));
  const placed: { categorieId: string; metierId: string | null; count: number }[] = [];
  for (const a of activity) {
    if (a.metierId && metierCategorie.has(a.metierId)) {
      placed.push({ categorieId: metierCategorie.get(a.metierId)!, metierId: a.metierId, count: a.count });
      continue;
    }
    if (a.categorieId && tree.some((c) => c.id === a.categorieId)) {
      placed.push({ categorieId: a.categorieId, metierId: null, count: a.count });
      continue;
    }
    const target = resolveLandingTarget(tree, { domaine: a.domaine });
    if (target) {
      placed.push({
        categorieId: target.categorie.id,
        metierId: target.kind === "metier" ? target.metier.id : null,
        count: a.count,
      });
    }
  }

  const coveredCategories = new Set<string>();
  const coveredMetiers = new Set<string>();
  const ranked: Ranked[] = items.map((item, order) => {
    const target = resolveLandingTarget(tree, { domaine: termOf(item) });
    if (!target) return { item, score: 0, added: false, order };
    if (target.kind === "categorie") {
      coveredCategories.add(target.categorie.id);
      const score = placed.filter((p) => p.categorieId === target.categorie.id).reduce((s, p) => s + p.count, 0);
      return { item, score, added: false, order };
    }
    coveredMetiers.add(target.metier.id);
    const score = placed.filter((p) => p.metierId === target.metier.id).reduce((s, p) => s + p.count, 0);
    return { item, score, added: false, order };
  });

  // Domaines actifs sans entrée : un par métier (le plus précis), à défaut par catégorie.
  const extra = new Map<string, Ranked>();
  for (const p of placed) {
    if (coveredCategories.has(p.categorieId) || (p.metierId && coveredMetiers.has(p.metierId))) continue;
    const key = p.metierId ?? `categorie:${p.categorieId}`;
    const existing = extra.get(key);
    if (existing) {
      existing.score += p.count;
      continue;
    }
    const categorie = tree.find((c) => c.id === p.categorieId)!;
    const metier = p.metierId ? categorie.metiers.find((m) => m.id === p.metierId) : undefined;
    const label = metier?.libelle ?? categorie.libelle;
    extra.set(key, {
      item: {
        label,
        sublabel: label,
        // Identifiant plutôt que libellé : plusieurs métiers partagent un nom (taxonomy-landing.ts).
        href: metier ? `/recherche?metier=${encodeURIComponent(metier.id)}` : `/recherche?categorie=${encodeURIComponent(categorie.id)}`,
        icon: categorie.icon ?? undefined,
      },
      score: p.count,
      added: true,
      order: extra.size,
    });
  }

  return [...ranked, ...extra.values()]
    .sort((a, b) => b.score - a.score || Number(a.added) - Number(b.added) || a.order - b.order)
    .slice(0, items.length)
    .map((r) => r.item);
}

// `cache` de React n'existe que dans un runtime serveur React (même garde que frontend-config.ts) :
// les trois blocs de l'accueil partagent ainsi une seule lecture par requête.
type Loader = () => Promise<{ tree: LandingCategorie[]; activity: LandingActivity[] }>;
const memoizePerRequest = (fn: Loader): Loader => (typeof cache === "function" ? cache(fn) : fn);

/** NE LÈVE JAMAIS : sans base, l'accueil retombe sur l'ordre éditorial. */
export const getLandingActivity = memoizePerRequest(async () => {
  try {
    const [tree, missions, gigs] = await Promise.all([
      prisma.categorie.findMany({
        orderBy: { ordre: "asc" },
        select: {
          id: true,
          libelle: true,
          description: true,
          icon: true,
          metiers: { select: { id: true, libelle: true, description: true }, orderBy: { libelle: "asc" } },
        },
      }),
      prisma.mission.groupBy({ by: ["categorieId", "metierId", "domaine"], where: { status: "publiee" }, _count: { _all: true } }),
      prisma.gig.groupBy({ by: ["domaine"], where: { status: "publie" }, _count: { _all: true } }),
    ]);
    const activity: LandingActivity[] = [
      ...missions.map((m) => ({ categorieId: m.categorieId, metierId: m.metierId, domaine: m.domaine, count: m._count._all })),
      ...gigs.map((g) => ({ categorieId: null, metierId: null, domaine: g.domaine, count: g._count._all })),
    ];
    return { tree, activity };
  } catch {
    return { tree: [], activity: [] };
  }
});

/** Entrées d'une section de l'accueil, classées par activité publiée. */
export async function rankedLandingItems(
  items: FrontendConfigItem[],
  termOf?: (item: FrontendConfigItem) => string,
): Promise<FrontendConfigItem[]> {
  const { tree, activity } = await getLandingActivity();
  return rankDomainsByActivity(items, tree, activity, termOf);
}
