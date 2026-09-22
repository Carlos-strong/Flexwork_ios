import { prisma } from "@/lib/db";
import { normalizeDomain } from "@/lib/domain-match";

/**
 * Slug d'URL à partir d'un libellé : minuscules, accents retirés, tout le reste en tirets.
 * « Électricité bâtiment » → « electricite-batiment ».
 *
 * Le slug n'est calculé qu'à la CRÉATION. Renommer « Maçonnerie » en « Gros œuvre » ne
 * déplace pas /maconnerie : une URL publiée est une promesse faite aux liens entrants et aux
 * moteurs de recherche, et la casser silencieusement depuis un champ de libellé serait le
 * genre de dégât qu'on ne constate que des semaines plus tard.
 */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export type DomainUsage = {
  missions: number;
  gigs: number;
  profiles: number;
  riskRules: number;
  total: number;
};

/**
 * Deux libellés de domaine désignent-ils la même chose ?
 *
 * Comparaison NORMALISÉE ET BIDIRECTIONNELLE : « Digital. » ≡ « digital », et « BTP » ≡
 * « BTP et Construction ». `missionDomainFilter` (src/lib/domain-match.ts) ne sait faire que
 * le premier sens, parce qu'une clause `where` Prisma ne peut pas tester l'inclusion inverse.
 * Pour un filtre d'affichage, ce demi-sens suffit. Pour un GARDE-FOU DE SUPPRESSION, non :
 * sous-compter l'usage, c'est autoriser l'effacement d'un domaine auquel des missions réelles
 * se rattachent. D'où le rapprochement en mémoire, sur les valeurs DISTINCTES — elles se
 * comptent par dizaines, jamais par milliers.
 */
function sameDomain(a: string, b: string): boolean {
  const left = normalizeDomain(a).toLowerCase();
  const right = normalizeDomain(b).toLowerCase();
  if (!left || !right) return false;
  return left === right || left.includes(right) || right.includes(left);
}

function countMatching(rows: { value: string | null; count: number }[], name: string): number {
  return rows.reduce((sum, row) => (row.value && sameDomain(row.value, name) ? sum + row.count : sum), 0);
}

/**
 * Ce qui, dans la base, se rattache à un domaine du référentiel.
 *
 * Mesure l'adhérence RÉELLE entre un référentiel tout neuf et quatre colonnes de texte libre
 * remplies avant lui (`Mission.domaine`, `Gig.domaine`, `Profile.mainDomain`,
 * `DomainRiskLevel.domain`). Sert deux usages : bloquer une suppression destructrice, et
 * afficher à l'administrateur la couverture de son référentiel — un domaine à zéro mission
 * n'est pas forcément inutile, mais un domaine qui ne correspond à AUCUNE saisie existante
 * signale soit un libellé mal choisi, soit un référentiel qui s'éloigne du terrain.
 */
export async function getDomainUsage(name: string): Promise<DomainUsage> {
  const [missions, gigs, profiles, risks] = await Promise.all([
    prisma.mission.groupBy({ by: ["domaine"], _count: { _all: true } }),
    prisma.gig.groupBy({ by: ["domaine"], _count: { _all: true } }),
    prisma.profile.groupBy({ by: ["mainDomain"], _count: { _all: true } }),
    prisma.domainRiskLevel.groupBy({ by: ["domain"], _count: { _all: true } }),
  ]);

  const usage = {
    missions: countMatching(missions.map((m) => ({ value: m.domaine, count: m._count._all })), name),
    gigs: countMatching(gigs.map((g) => ({ value: g.domaine, count: g._count._all })), name),
    profiles: countMatching(profiles.map((p) => ({ value: p.mainDomain, count: p._count._all })), name),
    riskRules: countMatching(risks.map((r) => ({ value: r.domain, count: r._count._all })), name),
  };

  return { ...usage, total: usage.missions + usage.gigs + usage.profiles + usage.riskRules };
}

/** Même mesure, pour tous les domaines à la fois — un seul aller-retour pour l'écran d'édition. */
export async function getAllDomainUsage(names: string[]): Promise<Record<string, DomainUsage>> {
  const [missions, gigs, profiles, risks] = await Promise.all([
    prisma.mission.groupBy({ by: ["domaine"], _count: { _all: true } }),
    prisma.gig.groupBy({ by: ["domaine"], _count: { _all: true } }),
    prisma.profile.groupBy({ by: ["mainDomain"], _count: { _all: true } }),
    prisma.domainRiskLevel.groupBy({ by: ["domain"], _count: { _all: true } }),
  ]);

  const missionRows = missions.map((m) => ({ value: m.domaine, count: m._count._all }));
  const gigRows = gigs.map((g) => ({ value: g.domaine, count: g._count._all }));
  const profileRows = profiles.map((p) => ({ value: p.mainDomain, count: p._count._all }));
  const riskRows = risks.map((r) => ({ value: r.domain, count: r._count._all }));

  const out: Record<string, DomainUsage> = {};
  for (const name of names) {
    const usage = {
      missions: countMatching(missionRows, name),
      gigs: countMatching(gigRows, name),
      profiles: countMatching(profileRows, name),
      riskRules: countMatching(riskRows, name),
    };
    out[name] = { ...usage, total: usage.missions + usage.gigs + usage.profiles + usage.riskRules };
  }
  return out;
}

/**
 * Libellés de domaine présents en base et absents du référentiel — la face inverse de la
 * couverture. Chacun est une saisie libre qu'aucune entrée ne décrit ; l'écran les propose à
 * l'ajout plutôt que de laisser l'administrateur inventer un référentiel hors-sol.
 */
export async function getUnreferencedDomains(): Promise<{ value: string; count: number }[]> {
  const [domains, missions, gigs, profiles] = await Promise.all([
    prisma.taxonomyDomain.findMany({ where: { status: { not: "archive" } }, select: { name: true } }),
    prisma.mission.groupBy({ by: ["domaine"], _count: { _all: true } }),
    prisma.gig.groupBy({ by: ["domaine"], _count: { _all: true } }),
    prisma.profile.groupBy({ by: ["mainDomain"], _count: { _all: true } }),
  ]);

  const known = domains.map((d) => d.name);
  const tally = new Map<string, number>();
  const add = (value: string | null, count: number) => {
    const clean = value ? normalizeDomain(value) : "";
    if (!clean) return;
    if (known.some((k) => sameDomain(k, clean))) return;
    tally.set(clean, (tally.get(clean) ?? 0) + count);
  };

  for (const m of missions) add(m.domaine, m._count._all);
  for (const g of gigs) add(g.domaine, g._count._all);
  for (const p of profiles) add(p.mainDomain, p._count._all);

  return [...tally.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
}
