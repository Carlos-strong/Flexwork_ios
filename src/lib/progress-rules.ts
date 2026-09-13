// Règles de progression et de décision communes au JALON et à la MISSION — module FEUILLE,
// sans aucun import.
//
// Ces trois règles étaient jusqu'ici écrites DEUX FOIS, à l'identique : une copie dans
// src/lib/jalons.ts (contrat fractionné) et une dans src/lib/attachments.ts (contrat sans
// jalon). Leurs commentaires assumaient la duplication pour ne pas faire dépendre le domaine
// mission du domaine jalon — intention juste, moyen coûteux : deux endroits où corriger la même
// règle, et rien pour signaler l'oubli du second. Un module feuille satisfait l'intention sans
// la copie : ni jalons.ts ni attachments.ts ne dépend de l'autre, tous deux dépendent d'ici.

// Bornage 0-100 appliqué par les routes declare-progress / observe-progress / checkpoint —
// jamais de contrainte DB (voir Jalon.declaredProgress et Mission.declaredProgress,
// prisma/schema.prisma).
export function isValidProgress(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

// Plancher du curseur de progression : le prestataire ne peut jamais PROPOSER une progression
// en dessous de la dernière progression effectivement VALIDÉE par le client
// (observedProgress). Un rejet remet declaredProgress à 0 — nouveau cycle de preuves — mais
// observedProgress reste acquis : la prochaine déclaration repart de ce plancher, jamais de 0.
//
// Volontairement PAS de plafond symétrique côté observe-progress/checkpoint : declaredProgress
// reste purement déclaratif et ne gate rien côté serveur — un plafond casserait ce principe
// déjà établi et testé (N15, src/lib/deliverable-no-jalon.e2e.test.ts).
export function isAboveProgressFloor(progress: number, observedProgress: number): boolean {
  return progress >= observedProgress;
}

// Le client ne peut constater une progression, confirmer un point d'étape, valider ou rejeter
// qu'une fois le livrable soumis. Remplace canDecideJalon(status) et canDecideMission(status),
// qui portaient la même condition sous deux noms.
export function canDecideDeliverable(status: string): boolean {
  return status === "livrable_soumis";
}
