import type { RiskLevel } from "@prisma/client";

// US-702 (Phase 7) — seule exception assumée du modèle v3 : sur le risque élevé, la
// déclaration seule ne suffit pas, une couverture EFFECTIVE est exigée, sans fenêtre de
// tolérance. Pas de blocage pour low/medium (déclaratif, avertissement renforcé côté UI
// au-delà d'un seuil — voir US-404).
export function canStartMission(riskLevel: RiskLevel, hasEffectiveCoverage: boolean): boolean {
  if (riskLevel === "high") return hasEffectiveCoverage;
  return true;
}

// Le plafond de la police couvre-t-il réellement le montant mis sous séquestre ? `canStartMission`
// ne regardait que l'EXISTENCE d'une couverture active : une police plafonnée à 100 000
// « couvrait » ainsi une mission à 5 000 000, ce qui vide la garantie de son sens sur
// exactement les missions qu'elle est censée protéger (risque élevé).
export function coversAmount(coverageCeiling: number, amount: number): boolean {
  return coverageCeiling >= amount;
}
