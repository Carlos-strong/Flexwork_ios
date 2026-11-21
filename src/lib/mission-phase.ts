// Phases de suivi d'une mission côté CLIENT (2026-11-11) — page Mes Missions (/client/missions),
// où se font le suivi et le monitoring de toutes les missions.
//
// Une phase traduit le statut technique (MissionStatus) en étape lisible, avec l'ACTION attendue
// du client et l'écran où la faire. Une annonce et ses engagements (src/lib/annonce-groups.ts)
// forment une mission : la phase de chaque engagement compte, et la prochaine action du groupe
// est la plus urgente de toutes. Logique pure, testée (mission-phase.test.ts).

export type Phase =
  | "recrutement"
  | "contrat"
  | "financement"
  | "en_cours"
  | "a_valider"
  | "litige"
  | "garantie"
  | "terminee"
  | "close"
  | "remboursee"
  | "annulee";

export const PHASE_LABEL: Record<Phase, string> = {
  recrutement: "Recrutement",
  contrat: "Contrat à signer",
  financement: "À financer",
  en_cours: "En cours",
  a_valider: "Livrable à valider",
  litige: "Litige",
  garantie: "Retenue de garantie",
  terminee: "Terminée",
  close: "Candidatures closes",
  remboursee: "Remboursée",
  annulee: "Annulée",
};

/** Teinte de badge (proto-ui Tone) par phase. */
export const PHASE_TONE: Record<Phase, "success" | "warning" | "danger" | "info" | "muted"> = {
  recrutement: "info",
  contrat: "warning",
  financement: "warning",
  en_cours: "success",
  a_valider: "warning",
  litige: "danger",
  garantie: "success",
  terminee: "success",
  close: "muted",
  remboursee: "muted",
  annulee: "muted",
};

export function phaseOf(status: string, pendingDeliverable = false): Phase {
  if (status === "livrable_soumis" || (pendingDeliverable && ["fonds_sous_sequestre", "en_cours"].includes(status))) return "a_valider";
  switch (status) {
    case "publiee":
      return "recrutement";
    case "proposition_acceptee":
    case "contrat_genere":
      return "contrat";
    case "contrat_signe":
      return "financement";
    case "fonds_sous_sequestre":
    case "en_cours":
      return "en_cours";
    case "mediation_ouverte":
      return "litige";
    case "validee":
      return "garantie";
    case "cloturee":
      return "terminee";
    case "remboursee":
      return "remboursee";
    case "annulee":
      return "annulee";
    default:
      return "close"; // annonce_close, brouillon
  }
}

export type MissionAction = { label: string; href: string; priority: number };

// Plus le nombre est petit, plus l'action est urgente.
const ACTION_FOR: Partial<Record<Phase, (id: string) => Omit<MissionAction, "href"> & { path: string }>> = {
  a_valider: () => ({ label: "Valider le livrable", path: "", priority: 1 }),
  litige: () => ({ label: "Suivre la médiation", path: "/mediation", priority: 2 }),
  contrat: () => ({ label: "Signer le contrat", path: "/contract", priority: 3 }),
  financement: () => ({ label: "Financer le séquestre", path: "/escrow", priority: 4 }),
};

/** Action attendue du client sur UNE mission (ou un engagement). */
export function actionFor(id: string, phase: Phase): MissionAction | null {
  const a = ACTION_FOR[phase]?.(id);
  return a ? { label: a.label, href: `/missions/${id}${a.path}`, priority: a.priority } : null;
}

/**
 * Prochaine action d'un groupe annonce + engagements : la plus urgente de ses engagements, sinon,
 * pendant le recrutement, l'examen des candidatures reçues.
 */
export function nextAction(
  group: { id: string; phase: Phase; pendingCandidatures: number },
  engagements: { id: string; phase: Phase }[],
): MissionAction | null {
  const candidates = [actionFor(group.id, group.phase), ...engagements.map((e) => actionFor(e.id, e.phase))].filter(
    (a): a is MissionAction => a !== null,
  );
  candidates.sort((a, b) => a.priority - b.priority);
  if (candidates[0]) return candidates[0];
  if (group.phase === "recrutement" && group.pendingCandidatures > 0) {
    return { label: `Examiner ${group.pendingCandidatures} candidature${group.pendingCandidatures > 1 ? "s" : ""}`, href: `/missions/${group.id}/proposals`, priority: 5 };
  }
  return null;
}

/** Résumé « 1 contrat à signer · 1 en cours » des phases des engagements. */
export function phaseSummary(phases: Phase[]): { phase: Phase; count: number }[] {
  const order: Phase[] = ["a_valider", "litige", "contrat", "financement", "en_cours", "garantie", "terminee", "remboursee"];
  return order.map((phase) => ({ phase, count: phases.filter((p) => p === phase).length })).filter((x) => x.count > 0);
}
