import type { MissionStatus } from "@prisma/client";

// Empêche le travail-test gratuit : aucun livrable ne peut être joint à une mission avant
// qu'une proposition n'ait été acceptée et le contrat généré.
const STATUSES_BEFORE_PROPOSAL_ACCEPTED: MissionStatus[] = ["brouillon", "publiee"];

export function canAttachLivrable(status: MissionStatus): boolean {
  return !STATUSES_BEFORE_PROPOSAL_ACCEPTED.includes(status);
}

// Soumission du LIVRABLE FINAL (audit workflow A-2, 2026-09-01) : plus strict que
// canAttachLivrable (qui gouverne les simples pièces jointes). Le livrable ne se soumet
// qu'une fois les fonds sous séquestre — livrer à `contrat_signe` violait la promesse
// « fonds sécurisés avant le travail » ET faisait sauter la mission de `contrat_signe` à
// `livrable_soumis` sans jamais traverser `fonds_sous_sequestre`. `en_cours` (pointage
// démarré) et `livrable_soumis` (re-soumission après rejet) restent ouverts.
export const DELIVERABLE_SUBMITTABLE_STATUSES: MissionStatus[] = [
  "fonds_sous_sequestre",
  "en_cours",
  "livrable_soumis",
];

export function canSubmitDeliverable(status: MissionStatus): boolean {
  return DELIVERABLE_SUBMITTABLE_STATUSES.includes(status);
}

// Progression déclarée/constatée — contrat SANS jalon (2026-09-03), pendant de
// canReportDeclaredProgress/canDecideJalon (src/lib/jalons.ts).
// Le prestataire peut déclarer/affiner son estimation tant que canSubmitDeliverable est vrai
// (même périmètre : fonds séquestrés, en cours d'exécution, ou déjà soumis en attente de
// décision) — purement déclaratif, ne gate rien côté serveur.
export function canReportMissionDeclaredProgress(status: MissionStatus): boolean {
  return canSubmitDeliverable(status);
}

// Règles communes au jalon et à la mission — définies une seule fois dans
// src/lib/progress-rules.ts (canDecideDeliverable y remplace l'ancien couple
// canDecideJalon/canDecideMission), ré-exportées ici pour que les routes du domaine mission
// gardent un point d'import unique.
export {
  canDecideDeliverable as canDecideMission,
  isValidProgress,
  isAboveProgressFloor,
} from "@/lib/progress-rules";
