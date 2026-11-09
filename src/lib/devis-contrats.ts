import type { MissionStatus, ProposalStatus } from "@prisma/client";

// Logique pure de répartition des devis/contrats en sous-rubriques du sidebar — alimente
// GET /api/devis-contrats et le bloc "Documents Contractuels" (sidebar, Sidecar-Devis-
// Contrats-Signes-Vjr). Un "devis" est une MissionProposal sur une mission en mode QUOTE
// (budgetType) dont le contrat n'a pas encore été généré ; dès qu'un PrestationContract
// existe, la proposition ne réapparaît plus ici — elle vit uniquement dans "Contrats Signés"
// (pas de double affichage du même engagement sous deux formes). EXCEPTION : mission clôturée,
// où le devis regagne sa rubrique terminale « Clôturés » à titre de trace historique.

export type DevisBucket = "brouillon" | "negociation" | "valide" | "rejete" | "cloture";
export type ContratBucket = "en_cours" | "cloture";

// "envoyee"/"preselectionnee" sans devis encore soumis = brouillon (candidature envoyée,
// en attente du premier devis chiffré). Dès qu'un devisData existe sans être encore en
// négociation formelle (cas théorique), on le traite comme "en_negociation" — jamais de
// devis chiffré affiché comme un simple brouillon.
export function devisBucket(
  status: ProposalStatus,
  hasDevisData: boolean,
  missionStatus: MissionStatus
): DevisBucket {
  // L'état TERMINAL de la MISSION prime, exactement comme `contratBucket` ci-dessous :
  // une fois la mission clôturée, tous ses devis sont clos. Sans ce premier garde, les
  // propositions NON retenues d'une mission terminée (jamais refusées explicitement, donc
  // restées `en_negociation`) s'affichaient « En négociation » à perpétuité et aucune
  // rubrique ne portait la fin de la négociation.
  if (missionStatus === "cloturee") return "cloture";
  switch (status) {
    case "envoyee":
    case "preselectionnee":
      return hasDevisData ? "negociation" : "brouillon";
    case "en_negociation":
      return "negociation";
    case "devis_valide":
    case "acceptee":
      return "valide";
    case "refusee":
    case "annulee_definitive":
      return "rejete";
    default:
      return "brouillon";
  }
}

export function contratBucket(missionStatus: MissionStatus): ContratBucket {
  return missionStatus === "cloturee" ? "cloture" : "en_cours";
}

// La proposition doit-elle apparaître dans la liste « Mes Devis » ? Elle en sort dès qu'un
// contrat est généré (elle vit alors dans « Contrats Signés »), SAUF si la mission est
// clôturée : le devis regagne alors sa rubrique terminale « Clôturés » à titre de trace
// historique. Sans cette exception, la rubrique « Clôturés » des devis restait vide — les
// propositions des missions terminées sont justement celles qui portent un contrat.
// Règle pure, partagée par GET /api/devis-contrats et testée sans Prisma.
export function devisVisibleInList(input: {
  hasContract: boolean;
  missionStatus: MissionStatus;
}): boolean {
  return !input.hasContract || input.missionStatus === "cloturee";
}

export const DEVIS_BUCKET_LABEL: Record<DevisBucket, string> = {
  brouillon: "Brouillon",
  negociation: "En négociation",
  valide: "Validé",
  rejete: "Rejeté",
  cloture: "Clôturé",
};

export const CONTRAT_BUCKET_LABEL: Record<ContratBucket, string> = {
  en_cours: "En cours",
  cloture: "Clôturé",
};
