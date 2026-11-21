// Découpage du parcours d'une mission en phases — source UNIQUE, partagée par le bandeau de
// suivi (src/components/mission-tracker.tsx) et la page /chronologie. Deux découpages
// différents du même parcours sur deux écrans ne disent pas la même chose à l'utilisateur
// (spécification d'écrans §8.3, principe 3).
//
// « Litige » est une phase À PART : une médiation ouverte suspend la progression, elle ne
// la prolonge pas. Elle n'est donc jamais « atteinte » par simple ordre séquentiel.
export const MISSION_PHASES = [
  "Offre & Candidature",
  "Signature",
  "Financement Escrow",
  "Pilotage Jalons",
  "Clôture",
  "Litige",
] as const;

export const LITIGE_INDEX = 5;
