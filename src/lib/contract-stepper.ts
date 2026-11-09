// Position du stepper visuel de la page contrat (src/app/missions/[id]/contract/page.tsx),
// extraite ici pour rester testable en pur (vitest, environment "node" — voir
// garant-rules.test.ts/devis.test.ts pour la même convention). Purement présentatif : ne
// pilote aucune logique métier, ne fait qu'illustrer où en est la mission.
export const CONTRACT_STEPS = ["Contrat", "Signature", "Financement", "Pilotage", "Clôture"] as const;

// "none" (le paramètre contract) porte déjà l'absence de contrat — pas besoin d'un champ
// contractExists distinct ici.
export type ContractStepInput = {
  clientSignedAt: string | null;
  providerSignedAt: string | null;
};

// L'ordre retenu (Signature avant Financement) suit le cycle réel de l'app (MissionStatus :
// contrat_signe précède fonds_sous_sequestre, voir src/lib/mission-status.ts) plutôt que
// l'ordre littéral de la maquette de référence (Flexwork-Vues-Vjr-International), qui
// ne correspond pas au flux HOLD-après-signature de Flexwork.
export function stepIndexFor(contract: ContractStepInput | "none", missionStatus: string | null): number {
  if (contract === "none") return 0;
  const bothSigned = !!contract.clientSignedAt && !!contract.providerSignedAt;
  if (!bothSigned) return 1;
  switch (missionStatus) {
    case "fonds_sous_sequestre":
    case "en_cours":
    case "livrable_soumis":
      return 3;
    case "validee":
    case "cloturee":
      return 4;
    default:
      return 2; // contrat_signe — en attente de mise sous séquestre
  }
}
