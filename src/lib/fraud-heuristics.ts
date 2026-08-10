// Détecte la réciprocité systématique de notes élevées entre deux comptes
// (avis mutuels suspects). Seuil de départ : 3 missions consécutives ou plus, note >= 4/5
// dans les deux sens — à affiner avec des données réelles, pas figé en dur définitivement.
export function detectMutualReviewSuspicion(
  consecutivePairs: { authorToTarget: number; targetToAuthor: number }[],
  minConsecutive = 3,
  minNote = 4
): boolean {
  if (consecutivePairs.length < minConsecutive) return false;

  const lastN = consecutivePairs.slice(-minConsecutive);
  return lastN.every((p) => p.authorToTarget >= minNote && p.targetToAuthor >= minNote);
}
