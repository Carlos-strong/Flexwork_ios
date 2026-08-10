import type { MissionStatus } from "@prisma/client";

// Empêche le travail-test gratuit : aucun livrable ne peut être joint à une mission avant
// qu'une proposition n'ait été acceptée et le contrat généré.
const STATUSES_BEFORE_PROPOSAL_ACCEPTED: MissionStatus[] = ["brouillon", "publiee"];

export function canAttachLivrable(status: MissionStatus): boolean {
  return !STATUSES_BEFORE_PROPOSAL_ACCEPTED.includes(status);
}
