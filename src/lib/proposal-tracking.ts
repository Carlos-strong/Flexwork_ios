// État et suivi d'une candidature (MissionProposal) — règle UNIQUE (2026-11-09).
//
// Elle vivait en deux copies quasi identiques : « Mes candidatures » côté prestataire
// (CandidaturesSection) et « Propositions » côté client (PropositionsSection), qui ne
// différaient que par un mot (« Envoyée » / « Reçue »). Le suivi affiché au tableau de bord
// (ApplicationsTrackingCard) en aurait fait une troisième. Chaque vue garde son point de vue
// (`viewer`) mais lit ici le MÊME badge, la MÊME étape et la MÊME prochaine action.

import { isRevisionPending, REVISION_REQUESTED_LABEL } from "@/lib/proposal-status";

export type ProposalViewer = "provider" | "client";

export type ProposalBadge =
  | "Envoyée"
  | "Reçue"
  | "En négociation"
  | "Révision demandée"
  | "Acceptée"
  | "Refusée"
  | "Contrat généré"
  | "Contrat signé"
  | "Fonds séquestrés"
  | "Travail en cours"
  | "Livrable soumis"
  | "Paiement libéré"
  | "Médiation en cours"
  | "Terminée";

/** Ce qu'il faut pour situer une candidature : son statut, et celui de la mission visée. */
export type TrackableProposal = {
  status: string;
  revisionRequestedAt?: string | Date | null;
  roundActuel?: number | null;
  mission: { status: string };
};

const BASE_STATUS: Record<string, "Envoyée" | "En négociation" | "Acceptée" | "Refusée"> = {
  envoyee: "Envoyée",
  preselectionnee: "En négociation",
  en_negociation: "En négociation",
  devis_valide: "En négociation",
  acceptee: "Acceptée",
  refusee: "Refusée",
  annulee_definitive: "Refusée",
};

// Candidature retenue : le badge suit l'avancement RÉEL de la mission (MissionStatus) au lieu
// de rester figé sur « Acceptée ». Libellés alignés sur src/lib/mission-status.ts.
const MISSION_STAGE: Record<string, ProposalBadge> = {
  proposition_acceptee: "Acceptée",
  contrat_genere: "Contrat généré",
  contrat_signe: "Contrat signé",
  fonds_sous_sequestre: "Fonds séquestrés",
  en_cours: "Travail en cours",
  livrable_soumis: "Livrable soumis",
  validee: "Paiement libéré",
  mediation_ouverte: "Médiation en cours",
  cloturee: "Terminée",
};

const isRetained = (p: TrackableProposal) => p.status === "acceptee" || p.status === "devis_valide";

/** Catégorie de filtre / statistique (4 statuts), selon le seul statut de candidature. */
export function proposalBaseStatus(p: Pick<TrackableProposal, "status">, viewer: ProposalViewer): ProposalBadge {
  const base = BASE_STATUS[p.status] ?? (viewer === "client" ? "Envoyée" : "En négociation");
  return base === "Envoyée" && viewer === "client" ? "Reçue" : base;
}

/** Badge affiché sur la carte. */
export function proposalBadge(p: TrackableProposal, viewer: ProposalViewer): ProposalBadge {
  // Révision demandée : le statut brut ne bouge pas, seul `revisionRequestedAt` est posé.
  // Le statut terminal prime (src/lib/proposal-status.ts).
  if (isRevisionPending(p)) return REVISION_REQUESTED_LABEL;
  if (isRetained(p)) return MISSION_STAGE[p.mission.status] ?? "Acceptée";
  return proposalBaseStatus(p, viewer);
}

export const PROPOSAL_BADGE_STYLE: Record<ProposalBadge, string> = {
  "Envoyée": "bg-[#DBEAFE] text-[#1D4ED8] border-[#BFDBFE]",
  "Reçue": "bg-[#DBEAFE] text-[#1D4ED8] border-[#BFDBFE]",
  "En négociation": "bg-[#FEF9C3] text-[#854D0E] border-[#FDE68A]",
  [REVISION_REQUESTED_LABEL]: "bg-[#EDE9FE] text-[#6D28D9] border-[#DDD6FE]",
  "Acceptée": "bg-[#E7F7EF] text-[#047857] border-[#BBF7D0]",
  "Refusée": "bg-[#FEECEB] text-[#B42318] border-[#FECACA]",
  "Contrat généré": "bg-[#FFF6E3] text-[#92400E] border-[#FCD34D]",
  "Contrat signé": "bg-[#FFF6E3] text-[#92400E] border-[#FCD34D]",
  "Fonds séquestrés": "bg-[#DBEAFE] text-[#1D4ED8] border-[#BFDBFE]",
  "Travail en cours": "bg-[#DBEAFE] text-[#1D4ED8] border-[#BFDBFE]",
  "Livrable soumis": "bg-[#DBEAFE] text-[#1D4ED8] border-[#BFDBFE]",
  "Paiement libéré": "bg-[#E7F7EF] text-[#047857] border-[#BBF7D0]",
  "Médiation en cours": "bg-[#FEECEB] text-[#B42318] border-[#FECACA]",
  "Terminée": "bg-[#191224] text-white border-[#191224]",
};

// ── Suivi : étape dans le parcours, et prochaine action ─────────────────────────────────────

/** Les étapes du parcours d'une candidature, de l'envoi à la fin de la mission. */
export const TRACKING_STEPS = ["Envoyée", "En discussion", "Retenue", "Contrat & séquestre", "Mission"] as const;

export type ProposalTracking = {
  badge: ProposalBadge;
  /** Index dans TRACKING_STEPS ; -1 = candidature close sans suite (refusée, annulée). */
  step: number;
  /** Prochaine étape, du point de vue de `viewer`. */
  next: string;
  /** C'est à `viewer` d'agir. */
  actionRequired: boolean;
  /** Regroupement du tableau de bord. */
  group: "en_attente" | "en_discussion" | "retenue" | "close";
};

export function trackProposal(p: TrackableProposal, viewer: ProposalViewer): ProposalTracking {
  const badge = proposalBadge(p, viewer);
  const isProvider = viewer === "provider";
  const t = (step: number, group: ProposalTracking["group"], next: string, actionRequired = false): ProposalTracking => ({
    badge,
    step,
    next,
    actionRequired,
    group,
  });

  if (p.status === "refusee") {
    return t(-1, "close", isProvider ? "Non retenue pour cette mission." : "Candidature écartée.");
  }
  if (p.status === "annulee_definitive") return t(-1, "close", "Négociation close sans accord.");

  if (isRevisionPending(p)) {
    return isProvider
      ? t(1, "en_discussion", "Le client demande une nouvelle version : à vous de la soumettre.", true)
      : t(1, "en_discussion", "En attente de la nouvelle version du prestataire.");
  }

  if (isRetained(p)) {
    switch (p.mission.status) {
      case "contrat_genere":
        return t(3, "retenue", "Contrat à signer par les deux parties.", true);
      case "contrat_signe":
        return isProvider
          ? t(3, "retenue", "Contrat signé : en attente du dépôt des fonds par le client.")
          : t(3, "retenue", "Contrat signé : déposez les fonds sous séquestre.", true);
      case "fonds_sous_sequestre":
        return isProvider
          ? t(4, "retenue", "Fonds sécurisés : vous pouvez démarrer la mission.", true)
          : t(4, "retenue", "Fonds sécurisés : le prestataire peut démarrer.");
      case "en_cours":
        return isProvider
          ? t(4, "retenue", "Mission en cours : soumettez le livrable une fois terminé.")
          : t(4, "retenue", "Mission en cours.");
      case "livrable_soumis":
        return isProvider
          ? t(4, "retenue", "Livrable soumis : en attente de validation du client.")
          : t(4, "retenue", "Livrable reçu : à valider.", true);
      case "validee":
        return t(4, "retenue", "Livrable validé, paiement libéré.");
      case "mediation_ouverte":
        return t(4, "retenue", "Médiation en cours.");
      case "cloturee":
        return t(4, "retenue", "Mission terminée.");
      default:
        return t(2, "retenue", "Retenue : le contrat est en préparation.");
    }
  }

  if (p.status === "preselectionnee") {
    return isProvider
      ? t(1, "en_discussion", "Présélectionnée : le client étudie votre offre.")
      : t(1, "en_discussion", "Présélectionnée : à départager.", true);
  }
  if (p.status === "en_negociation") {
    const round = p.roundActuel ?? 0;
    return t(1, "en_discussion", round > 0 ? `Négociation en cours (version ${round + 1}).` : "Négociation en cours.");
  }
  // envoyee
  return isProvider
    ? t(0, "en_attente", "En attente de la réponse du client.")
    : t(0, "en_attente", "Nouvelle candidature : à examiner.", true);
}

export type ProposalTrackingSummary = {
  total: number;
  en_attente: number;
  en_discussion: number;
  retenue: number;
  close: number;
  actionRequired: number;
};

export function summarizeProposals(list: TrackableProposal[], viewer: ProposalViewer): ProposalTrackingSummary {
  const s: ProposalTrackingSummary = { total: 0, en_attente: 0, en_discussion: 0, retenue: 0, close: 0, actionRequired: 0 };
  for (const p of list) {
    const tr = trackProposal(p, viewer);
    s.total += 1;
    s[tr.group] += 1;
    if (tr.actionRequired) s.actionRequired += 1;
  }
  return s;
}
