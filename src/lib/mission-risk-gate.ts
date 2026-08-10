import type { RiskLevel } from "@prisma/client";

// US-702 (Phase 7) — seule exception assumée du modèle v3 : sur le risque élevé, la
// déclaration seule ne suffit pas, une couverture EFFECTIVE est exigée, sans fenêtre de
// tolérance. Pas de blocage pour low/medium (déclaratif, avertissement renforcé côté UI
// au-delà d'un seuil — voir US-404).
export function canStartMission(riskLevel: RiskLevel, hasEffectiveCoverage: boolean): boolean {
  if (riskLevel === "high") return hasEffectiveCoverage;
  return true;
}
