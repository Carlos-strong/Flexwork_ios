import type { DevisData } from "@/lib/devis";
import { personFullName } from "@/lib/person-name";

export type DevisRevisionPayload = {
  id: string;
  roundNumber: number;
  comment: string | null;
  createdAt: string;
  devisData: DevisData;
  author: { firstname: string | null; lastname: string | null };
};

export type DevisProposalPayload = {
  id: string;
  montant: number;
  // Contre-proposition : délai (jours) proposé par le prestataire, null si non renseigné
  // (le contrat retombe alors sur mission.delaiJours).
  delaiPropose: number | null;
  message: string | null;
  status: string;
  roundActuel: number;
  devisData: DevisData | null;
  devisValideAt: string | null;
  // Non nul uniquement quand le client a explicitement demandé une révision (POST
  // .../devis/request-revision) — c'est le seul déclencheur de la carte "Réviser le devis"
  // côté prestataire (voir canProviderReviseDevis, src/lib/devis.ts).
  revisionRequestedAt: string | null;
  revisionRequestMessage: string | null;
  // Posés uniquement par un rejet explicite du client (POST .../devis/reject) — distincts du
  // passage à "refusee" en effet de bord de l'acceptation d'une AUTRE proposition, qui ne
  // renseigne jamais ces deux champs.
  devisRejectedAt: string | null;
  devisRejectionReason: string | null;
  createdAt: string;
  provider: { id: string; email: string; firstname: string | null; lastname: string | null; avatarPath?: string | null; country?: string | null };
  // Note moyenne réelle (Review, suspendu:false) et nombre d'offres déjà envoyées à ce
  // candidat pour cette mission (model Offer) — optionnels : uniquement calculés par
  // GET /api/missions/[id]/proposals (pas par le flux de candidature lui-même).
  averageRating?: number | null;
  offersSent?: number;
  // Cartes « Candidatures reçues » (2026-11-11) — missions menées à terme et compétences
  // déclarées du candidat (GET /api/missions/[id]/proposals uniquement).
  missionsCompleted?: number;
  skills?: string[];
  // Candidature RETENUE (2026-11-11) : son engagement et l'état de signature de son contrat —
  // renvoyés dans `retained` par GET /api/missions/[id]/proposals (client propriétaire).
  engagement?: {
    id: string;
    status: string;
    contract: { clientSignedAt: string | null; providerSignedAt: string | null } | null;
  };
  revisions: DevisRevisionPayload[];
};

export function authorDisplayName(author: {
  firstname: string | null;
  lastname: string | null;
}): string {
  const name = personFullName(author);
  return name || "Prestataire";
}

// Libellé du statut réel d'une MissionProposal — partagé entre DevisPanel (missions en
// mode devis QUOTE) et la carte "Ma candidature" de /missions/[id] (missions à prix
// fixe/taux, qui n'ont pas de DevisPanel) pour ne pas avoir deux formulations différentes
// du même statut selon le type de mission.
export const PROPOSAL_STATUS_LABEL: Record<string, string> = {
  envoyee: "Candidature envoyée",
  preselectionnee: "Présélectionné",
  en_negociation: "En négociation",
  devis_valide: "Devis validé",
  acceptee: "Acceptée",
  refusee: "Refusée",
  annulee_definitive: "Annulée",
};
