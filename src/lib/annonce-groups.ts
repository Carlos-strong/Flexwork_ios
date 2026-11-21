// Regroupement « annonce → engagements » pour les vues du CLIENT (2026-11-11).
//
// Depuis les annonces (src/lib/accept-proposal.ts), retenir un prestataire crée un ENGAGEMENT :
// une mission enfant (`parentMissionId`) qui porte son contrat. Les listes brutes du client
// (GET /api/missions, /api/dashboard/client-summary) contiennent donc l'annonce ET chacun de
// ses engagements — utile aux badges et aux validations, qui vivent sur l'engagement, mais
// faux à l'écran : une annonce à 3 places avec 2 retenus s'affichait comme 3 missions.
//
// Ici, une seule règle pour toutes les vues : on affiche les missions de premier niveau,
// chacune avec ses engagements rattachés. Un engagement dont l'annonce n'est pas dans la liste
// (cas limite : annonce supprimée) reste affiché seul plutôt que de disparaître.

export type GroupableMission = { id: string; parentMissionId?: string | null };

export type MissionGroup<M extends GroupableMission> = { mission: M; engagements: M[] };

export function groupAnnonces<M extends GroupableMission>(missions: M[]): MissionGroup<M>[] {
  const ids = new Set(missions.map((m) => m.id));
  const children = new Map<string, M[]>();
  for (const m of missions) {
    // Un engagement annulé (désistement, 2026-11-11) n'est ni un retenu, ni une mission à part.
    if ((m as { status?: string }).status === "annulee") continue;
    if (m.parentMissionId && ids.has(m.parentMissionId)) {
      const list = children.get(m.parentMissionId) ?? [];
      list.push(m);
      children.set(m.parentMissionId, list);
    }
  }
  return missions
    .filter((m) => !m.parentMissionId || !ids.has(m.parentMissionId))
    .map((m) => ({ mission: m, engagements: children.get(m.id) ?? [] }));
}

// Statuts d'une mission dont l'exécution est en cours (contrat en préparation ou engagé).
export const ACTIVE_EXECUTION_STATUSES = [
  "proposition_acceptee",
  "contrat_genere",
  "contrat_signe",
  "fonds_sous_sequestre",
  "en_cours",
  "livrable_soumis",
  "mediation_ouverte",
  "validee",
] as const;

export function isExecuting(status: string): boolean {
  return (ACTIVE_EXECUTION_STATUSES as readonly string[]).includes(status);
}

/** Une mission (ou l'une de ses engagements) est-elle en cours d'exécution ? */
export function groupIsActive(g: MissionGroup<GroupableMission & { status: string }>): boolean {
  return isExecuting(g.mission.status) || g.engagements.some((e) => isExecuting(e.status));
}

/** Terminée : clôturée elle-même, ou annonce fermée dont tous les engagements sont clôturés. */
export function groupIsClosed(g: MissionGroup<GroupableMission & { status: string }>): boolean {
  if (g.mission.status === "cloturee") return true;
  return g.mission.status === "annonce_close" && g.engagements.length > 0 && g.engagements.every((e) => e.status === "cloturee");
}

// Filtres des listes du client (« Publiées », « En cours », « Terminées », « En litige ») pour
// un GROUPE : une annonce encore ouverte dont un engagement est en cours relève des deux.
export type GroupFilterTag = "Publiées" | "En cours" | "Terminées" | "En litige";
const IN_PROGRESS = ["proposition_acceptee", "contrat_genere", "contrat_signe", "fonds_sous_sequestre", "en_cours", "livrable_soumis"];
const DONE = ["validee", "cloturee"];

export function groupFilterTags(g: MissionGroup<GroupableMission & { status: string }>): GroupFilterTag[] {
  const tags = new Set<GroupFilterTag>();
  const all = [g.mission, ...g.engagements];
  if (g.mission.status === "publiee") tags.add("Publiées");
  if (all.some((m) => IN_PROGRESS.includes(m.status))) tags.add("En cours");
  if (all.some((m) => m.status === "mediation_ouverte")) tags.add("En litige");
  const executions = g.engagements.length > 0 ? g.engagements : [g.mission];
  if (groupIsClosed(g) || (g.mission.status !== "publiee" && executions.every((m) => DONE.includes(m.status)))) tags.add("Terminées");
  return [...tags];
}
