// Historique des points d'étape confirmés ("validations partielles" — voir POST
// .../checkpoint) — partagé entre la vue client (ValidationClientView, qui les pose) et la
// vue prestataire (missions/[id]/deliverable, qui doit pouvoir les consulter : le prestataire
// a besoin de voir que le client a confirmé une étape, pas seulement le client qui l'a posée).
//
// Ce module portait cinq fonctions et composants de plus (latestCheckpointProgress,
// groupCheckpointsByJalon, CheckpointProgressBar, CheckpointHistoryTable, CheckpointHistory),
// retirés le 16/09/2026 : plus rien ne les appelait, ni ici ni ailleurs, les écrans ayant
// depuis intégré leur propre rendu des points d'étape. Le fichier n'a plus besoin d'être un
// composant client — il ne rend plus rien.

export type Checkpoint = {
  id: string;
  jalonId: string | null;
  jalonTitre: string | null;
  jalonOrdre: number | null;
  progress: number;
  validatedByName: string;
  createdAt: string;
};

// Cumul CONFIRMÉ (monotone) pour l'affichage du taux de progression validé (en-tête de carte,
// bandeau récapitulatif) : le niveau le PLUS HAUT jamais confirmé par un point d'étape. Un
// point d'étape enregistre la progression constatée à un instant (cumul croissant) — si une
// confirmation arrive en baisse (régression, ex. test manuel : 65 % puis 15 %), le cumul ne
// doit PAS redescendre : le MAX des points d'étape fait foi. Signalé 2026-09-05 (« la valeur
// cumulée de l'en-tête ne s'est pas mise à jour par rapport au taux cumulé ») : l'en-tête
// restait bloqué sur le dernier point d'étape (15 %) au lieu du cumul réel (65 %).
export function cumulativeCheckpointProgress(checkpoints: Checkpoint[]): number | null {
  if (checkpoints.length === 0) return null;
  return Math.max(...checkpoints.map((c) => c.progress));
}
