// Règles d'ouverture d'une médiation — partagées par la route (POST /api/missions/[id]/mediation)
// et par l'interface qui propose de l'ouvrir (bandeau de suivi, src/components/mission-tracker.tsx).
// Logique pure, sans Prisma (même convention que review-rules.ts) : les deux gardes doivent
// tomber ensemble, sinon l'écran propose un geste que l'API refuse, ou l'inverse.

// Phases où une médiation est recevable : les fonds sont engagés et la mission n'est pas
// terminée. Volontairement restrictif — ouvrir une médiation coûte cher (elle suspend le
// cycle de vie de la mission), elle ne doit pas l'être « au cas où ».
export const MEDIABLE_MISSION_STATUSES = [
  "fonds_sous_sequestre",
  "en_cours",
  "livrable_soumis",
  "validee",
] as const;

export function canOpenMediationAtStatus(status: string): boolean {
  return (MEDIABLE_MISSION_STATUSES as readonly string[]).includes(status);
}
