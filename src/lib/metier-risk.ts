import type { RiskLevel } from "@prisma/client";

// Palier de risque d'un MÉTIER (2026-09-24) — remplace `resolveMissionRisk`, qui lisait
// `DomainRiskLevel` sur un libellé libre.
//
// Pourquoi le risque a changé de support : la table `DomainRiskLevel` indexait le risque sur un
// texte (`domain`) et un pays. Or sur les 220 métiers du catalogue, 4 seulement y trouvaient une
// ligne, et les 4 lignes classées « high » — Électricité, Travail en hauteur, Gros œuvre, Engins
// de chantier — n'en désignaient AUCUN (le catalogue dit « Électricité bâtiment », « Électricité
// industrielle »…). Résultat : `Mission.riskLevel` ne pouvait jamais valoir `high`, et
// l'obligation d'assurance qui en dépend ne s'est jamais déclenchée, ni à la candidature
// (`candidature-guard.ts`) ni au séquestre (`escrow.ts`).
//
// Le risque vit donc désormais sur le métier, posé par l'administrateur dans la taxonomie. Il ne
// peut plus être orphelin — il voyage avec la ligne à laquelle il s'applique — et il est connu du
// formulaire dès la SÉLECTION du métier, sans requête supplémentaire.

// `RiskLevel` tel que défini côté base (prisma/schema.prisma). La liste est répétée ici parce
// qu'elle sert aussi d'énumération de saisie : un `z.enum` a besoin de littéraux, pas d'un type
// Prisma effacé à la compilation.
export const RISK_LEVEL_VALUES = ["low", "medium", "high"] as const;

export function isRiskLevel(value: unknown): value is RiskLevel {
  return typeof value === "string" && (RISK_LEVEL_VALUES as readonly string[]).includes(value);
}

/**
 * L'assurance est exigée si et seulement si le palier est `high` — règle du modèle
 * (modele-skillafrica-v3 §7.2), et non un réglage indépendant.
 *
 * C'est pour cela que `Metier` ne porte PAS de colonne `insuranceRequired` : un booléen séparé
 * serait une seconde vérité à tenir d'accord avec la première, et la seule façon de le désaccorder
 * serait de rendre l'assurance exigible sur un palier… qui ne l'exige pas.
 */
export function insuranceRequiredFor(riskLevel: RiskLevel | null | undefined): boolean {
  return riskLevel === "high";
}

// Libellés et explications de l'écran d'administration. La formulation de `high` reprend celle
// affichée au prestataire : celui qui classe le métier doit lire EXACTEMENT ce que le prestataire
// lira, sinon la conséquence du réglage reste abstraite.
export const RISK_LEVELS: { value: RiskLevel; label: string; hint: string }[] = [
  { value: "low", label: "Faible", hint: "Aucune assurance exigée." },
  { value: "medium", label: "Moyen", hint: "Aucune assurance exigée à ce palier." },
  {
    value: "high",
    label: "Élevé",
    hint: "Assurance RC Pro exigée avant de candidater et avant tout séquestre.",
  },
];

// Libellé d'affichage : tolérant à une simple chaîne, parce qu'il sert aussi aux écrans qui
// manipulent la valeur dans un `<select>` (donc typée `string`) et à une colonne ramenée d'une
// requête partielle. Un palier inconnu retombe sur « Faible » — jamais vide à l'écran.
export function riskLevelLabel(riskLevel: string | null | undefined): string {
  return RISK_LEVELS.find((r) => r.value === riskLevel)?.label ?? "Faible";
}
