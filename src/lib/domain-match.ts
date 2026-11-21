// Rapprochement mission ↔ prestataire par DOMAINE — règle unique, partagée par la liste des
// missions ouvertes (GET /api/missions), le résumé du dashboard prestataire
// (/api/dashboard/provider-summary) et la diffusion d'une mission à sa publication.
//
// Ces trois chemins comparaient `Mission.domaine` à `Profile.mainDomain` par ÉGALITÉ STRICTE,
// sur deux champs pourtant saisis à la main, à des moments différents, par deux personnes
// différentes. Le moindre écart de casse, d'espace ou de ponctuation suffisait à ce qu'une
// mission n'atteigne jamais le prestataire correspondant : un profil « Digital. » (avec le
// point final) ne matchait ni « Digital » ni « digital », et la publication annonçait
// sereinement « 0 prestataire(s) du domaine … notifiés ».
//
// La recherche publique de prestataires (src/app/api/search/prestataires/route.ts) avait déjà
// tranché exactement cette question, et pour le même motif — son commentaire : « un visiteur
// tape "design", pas la valeur exacte du champ mainDomain saisie par le prestataire (ex.
// "Digital.") ». Le raisonnement vaut à l'identique dans l'autre sens ; il est ici écrit une
// fois et réutilisé, plutôt que redécouvert chemin par chemin.
//
// Module PUR (aucun import Prisma) : il ne produit qu'un fragment de clause `where`.

/**
 * Forme comparable d'un libellé de domaine : sans espaces de bord, sans ponctuation finale
 * (« Digital. » → « Digital »). La casse est laissée au filtre `insensitive` de Prisma.
 */
export function normalizeDomain(value: string): string {
  return value.trim().replace(/[.,;:/\s]+$/u, "");
}

/**
 * Fragment de `where` Prisma filtrant les missions sur le domaine d'un prestataire.
 *
 * Correspondance PARTIELLE et insensible à la casse, dans le sens « le domaine de la mission
 * contient celui du profil » : un profil « Digital » atteint « Digital », « digital » et
 * « Digital / Web ». Un libellé vide (profil incomplet) ne filtre rien — le prestataire voit
 * alors toutes les missions ouvertes, ce qui reste préférable à n'en voir aucune.
 */
export function missionDomainFilter(mainDomain: string | null | undefined) {
  const needle = mainDomain ? normalizeDomain(mainDomain) : "";
  if (!needle) return {};
  return { domaine: { contains: needle, mode: "insensitive" as const } };
}

/**
 * Pendant du filtre ci-dessus, dans l'autre sens : les profils dont le domaine correspond à
 * celui d'une mission, pour décider qui notifier à la publication.
 */
export function profileDomainFilter(missionDomaine: string | null | undefined) {
  const needle = missionDomaine ? normalizeDomain(missionDomaine) : "";
  if (!needle) return {};
  return { mainDomain: { contains: needle, mode: "insensitive" as const } };
}
