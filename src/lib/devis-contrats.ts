import type { MissionStatus, ProposalStatus } from "@prisma/client";

// Logique pure de répartition des devis/contrats en sous-rubriques du sidebar — alimente
// GET /api/devis-contrats et le bloc "Documents Contractuels" (sidebar, Sidecar-Devis-
// Contrats-Signes-Vjr). Un "devis" est une MissionProposal sur une mission en mode QUOTE
// (budgetType) dont le contrat n'a pas encore été généré ; dès qu'un PrestationContract
// existe, la proposition ne réapparaît plus ici — elle vit uniquement dans "Contrats Signés"
// (pas de double affichage du même engagement sous deux formes).

export type DevisBucket = "brouillon" | "negociation" | "valide" | "rejete";
export type ContratBucket = "en_cours" | "cloture";

// "envoyee"/"preselectionnee" sans devis encore soumis = brouillon (candidature envoyée,
// en attente du premier devis chiffré). Dès qu'un devisData existe sans être encore en
// négociation formelle (cas théorique), on le traite comme "en_negociation" — jamais de
// devis chiffré affiché comme un simple brouillon.
export function devisBucket(status: ProposalStatus, hasDevisData: boolean): DevisBucket {
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

export const DEVIS_BUCKET_LABEL: Record<DevisBucket, string> = {
  brouillon: "Brouillon",
  negociation: "En négociation",
  valide: "Validé",
  rejete: "Rejeté",
};

export const CONTRAT_BUCKET_LABEL: Record<ContratBucket, string> = {
  en_cours: "En cours",
  cloture: "Clôturé",
};
