// Enchaînement réel d'une mission après sélection du prestataire (2026-09-09) :
//
//   Offre acceptée → Signature → Financement séquestre → Pilotage des jalons
//
// Ces quatre étapes existaient déjà, mais éclatées sur autant de pages sans fil conducteur :
// la modale de candidature se terminait sur « vous pouvez générer le contrat depuis le détail
// de la mission », sans lien, et le client devait deviner où aller ensuite. Ce module dérive
// l'étape courante du SEUL état réel (MissionStatus) et donne l'action suivante — aucune
// donnée nouvelle, aucun choix supplémentaire à faire.
//
// L'ordre suit le cycle applicatif (contrat_signe précède fonds_sous_sequestre), le même que
// CONTRACT_STEPS dans src/lib/contract-stepper.ts, restreint ici aux étapes qui suivent
// l'acceptation d'une candidature.

export const MISSION_FLOW_STEPS = [
  { id: "offre", label: "Offre acceptée" },
  { id: "signature", label: "Signature" },
  { id: "financement", label: "Financement séquestre" },
  { id: "pilotage", label: "Pilotage des jalons" },
] as const;

export type MissionFlowStepId = (typeof MISSION_FLOW_STEPS)[number]["id"];

export type MissionFlowStep = {
  id: MissionFlowStepId;
  label: string;
  done: boolean;
  current: boolean;
};

export type MissionFlow = {
  steps: MissionFlowStep[];
  /** Action suivante — null quand il n'y a plus rien à faire avancer (mission clôturée). */
  cta: { label: string; href: string } | null;
  /** Phrase courte expliquant ce qui est attendu, affichée à côté du bouton. */
  hint: string;
};

// Index de l'étape EN COURS pour chaque statut de mission (voir MISSION_STATUSES,
// src/lib/mission-status.ts). Les statuts antérieurs à l'acceptation n'ont pas de position
// dans ce flux : la vue ne l'affiche que sur une candidature retenue.
const CURRENT_INDEX: Record<string, number> = {
  proposition_acceptee: 1, // offre acceptée ✓ — reste à établir puis signer le contrat
  contrat_genere: 1, // contrat prêt, signatures en attente
  contrat_signe: 2, // signé des deux côtés — reste à mettre les fonds sous séquestre
  fonds_sous_sequestre: 3,
  en_cours: 3,
  livrable_soumis: 3,
  mediation_ouverte: 3,
  validee: 4, // tout est fait
  cloturee: 4,
};

export function missionFlow(missionId: string, status: string | null | undefined): MissionFlow {
  const currentIndex = CURRENT_INDEX[status ?? ""] ?? 0;

  const steps: MissionFlowStep[] = MISSION_FLOW_STEPS.map((s, i) => ({
    id: s.id,
    label: s.label,
    done: i < currentIndex,
    current: i === currentIndex,
  }));

  const base = `/missions/${missionId}`;
  switch (status) {
    case "proposition_acceptee":
      return { steps, hint: "Étape suivante : établir le contrat et le faire signer.", cta: { label: "Générer le contrat", href: `${base}/contract` } };
    case "contrat_genere":
      return { steps, hint: "Le prestataire signe en premier, vous contre-signez sous 48h.", cta: { label: "Ouvrir la signature", href: `${base}/contract` } };
    case "contrat_signe":
      return { steps, hint: "Contrat signé des deux côtés : placez les fonds sous séquestre pour lancer le travail.", cta: { label: "Financer le séquestre", href: `${base}/escrow` } };
    case "fonds_sous_sequestre":
      return { steps, hint: "Fonds sécurisés : suivez les jalons et validez au fil de l'avancement.", cta: { label: "Piloter les jalons", href: base } };
    case "en_cours":
    case "livrable_soumis":
      return { steps, hint: "Travail engagé : suivez l'avancement et validez les livrables.", cta: { label: "Piloter les jalons", href: base } };
    case "mediation_ouverte":
      return { steps, hint: "Une médiation est ouverte sur cette mission.", cta: { label: "Voir la mission", href: base } };
    case "validee":
      // Tous les jalons sont payés ; seule la retenue de garantie (mode J4) reste à confirmer
      // côté PSP. Ne pas annoncer « terminée » tant que ce dernier mouvement n'est pas arrivé.
      return { steps, hint: "Tous les jalons sont validés et payés — la retenue de garantie est en cours de libération.", cta: { label: "Voir la mission", href: base } };
    case "cloturee":
      return { steps, hint: "Mission terminée — les fonds ont été libérés.", cta: { label: "Voir la mission", href: base } };
    default:
      // Statut antérieur à l'acceptation : aucune étape de ce flux n'est encore engagée.
      return { steps, hint: "Retenez une candidature pour lancer la mission.", cta: null };
  }
}
