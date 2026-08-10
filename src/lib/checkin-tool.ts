// A12 (etat-consolide-Flexwork.md §2) — outil de pointage, preuve entre les parties.
// AUCUNE fonction de ce fichier ne doit jamais alimenter un score, un classement, une
// visibilité, une pénalité ou une décision de litige — voir la règle de conformité n°8
// (Prompts_Sprints_UserStories.md). Si un futur besoin "score les retards" apparaît, c'est
// un signal que la fonctionnalité bascule du service vers le contrôle : refuser (A12).

const CONTESTATION_DELAY_MS = 7 * 24 * 60 * 60 * 1000; // aligné sur le délai d'acceptation tacite (US-505)

// Rétention courte : fin de mission + délai de contestation, puis suppression
// (prérequis bloquant #7, protection des données — la géolocalisation est une donnée
// sensible même si l'usage reste "aveugle" pour la plateforme).
export function computeCheckInRetentionDate(missionDeadline: Date): Date {
  return new Date(missionDeadline.getTime() + CONTESTATION_DELAY_MS);
}

// Le pointage n'est actif que si les DEUX parties ont consenti — le refus de l'une ou
// l'autre est sans conséquence sur le reste du contrat (condition impérative n°1, A12).
export function isCheckInToolActive(clientOptedIn: boolean, providerOptedIn: boolean): boolean {
  return clientOptedIn && providerOptedIn;
}
