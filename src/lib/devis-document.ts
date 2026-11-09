// Composition du DEVIS DÉFINITIF — pendant de src/lib/contract-clauses.ts pour le contrat.
//
// « Définitif » ne qualifie pas une mise en forme mais un ÉTAT : le devis qu'un client a
// validé (`devis_valide`) ou accepté (`acceptee`). Tant que la négociation court, le chiffrage
// change à chaque round et il n'y a rien à figer ; c'est la validation qui arrête le prix, et
// c'est ce prix-là qui devient celui du contrat. Le document exporté est donc la pièce
// justificative de cet accord, entre la proposition et le contrat signé.
//
// Module PUR (aucun import Prisma, comme devis.ts, jalons.ts et financing-modes.ts) : toute
// la composition est testable sans base, et l'écran, le PDF et l'export HTML partagent la
// même source de vérité plutôt que de reconstruire chacun son tableau — c'est exactement
// l'écart que buildContractSections a supprimé côté contrat.

import type { DevisData } from "@/lib/devis";

export type DevisDocumentParty = {
  /** Nom affiché en en-tête de bloc. */
  name: string;
  /** Qualité de la partie, ex. « Client » ou « Expert digital — travailleur indépendant ». */
  roleLabel: string;
  lines: { label: string; value: string }[];
};

export type DevisDocumentLine = {
  /** Numéro d'ordre affiché, « 01 », « 02 »… */
  numero: string;
  description: string;
  quantite: string;
  unite: string;
  prixUnitaire: string;
  montant: string;
  echeance: string;
};

export type DevisDocumentTotal = { label: string; value: string; emphasis?: boolean };

export type DevisDocument = {
  reference: string;
  titre: string;
  missionTitre: string;
  /** Statut lisible : « Devis définitif — validé le … » ou la mention d'un devis encore ouvert. */
  mention: string;
  client: DevisDocumentParty;
  provider: DevisDocumentParty;
  lines: DevisDocumentLine[];
  totals: DevisDocumentTotal[];
  conditions: { label: string; value: string }[];
  notes: string;
  /** Clauses de bas de document — ce que le devis engage, et ce qu'il n'engage pas. */
  mentionsLegales: string[];
};

export type DevisDocumentInput = {
  proposalId: string;
  missionTitre: string;
  missionDescription: string;
  devise: string;
  devis: DevisData;
  /**
   * Le client a-t-il arrêté ce devis ? Vient du STATUT de la proposition, pas de la présence
   * d'une date : `devisValideAt` n'existe pas sur les propositions antérieures à son ajout, et
   * un devis réellement validé s'imprimerait alors « en négociation » — soit l'inverse de son
   * état réel, sur la pièce censée l'établir.
   */
  definitif: boolean;
  /** Date de validation, quand elle est connue. */
  valideLe: Date | null;
  /** Round auquel le devis s'est arrêté — un devis validé au round 3 n'est pas le premier chiffrage. */
  round: number;
  /** Nombre maximal de rounds de négociation prévu à la publication. */
  roundsMax: number;
  client: { name: string; adresse: string; tel: string; email: string; roleLabel: string };
  provider: { name: string; adresse: string; tel: string; email: string; roleLabel: string };
  /** Délai de validité du devis, en jours. */
  validiteJours: number;
};

/** Référence courte et stable, même forme que celle du contrat (8 caractères, majuscules). */
export function devisReference(proposalId: string): string {
  return proposalId.slice(0, 8).toUpperCase();
}

function montant(n: number, devise: string): string {
  return `${Math.round(n).toLocaleString("fr-FR")} ${devise}`;
}

function dateLongue(d: Date): string {
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Date d'expiration de la validité du devis. Calculée en jours pleins depuis la validation :
 * un devis sans terme laisserait croire qu'un prix chiffré engage son auteur indéfiniment.
 */
export function dateExpiration(valideLe: Date, validiteJours: number): Date {
  const d = new Date(valideLe);
  d.setDate(d.getDate() + validiteJours);
  return d;
}

export function buildDevisDocument(input: DevisDocumentInput): DevisDocument {
  const { devis, devise } = input;

  const lines: DevisDocumentLine[] = devis.lineItems.map((item, i) => ({
    numero: String(i + 1).padStart(2, "0"),
    description: item.description.trim() || `Poste ${i + 1}`,
    quantite: String(item.quantity),
    unite: item.unit,
    prixUnitaire: montant(item.unitPrice, devise),
    montant: montant(item.total, devise),
    echeance: item.echeance?.trim() || "—",
  }));

  // La main d'œuvre est une rubrique SÉPARÉE des postes (voir DevisData.laborCost) : elle
  // s'additionne au total HT sans se fondre dans les lignes, et ne doit donc apparaître comme
  // ligne de total que lorsqu'elle est réellement chiffrée — un « 0 XOF » permanent ferait
  // croire à un oubli du prestataire plutôt qu'à une absence de poste.
  const totals: DevisDocumentTotal[] = [];
  if (devis.laborCost > 0) {
    totals.push({ label: "Main d'œuvre", value: montant(devis.laborCost, devise) });
  }
  totals.push({ label: "Total HT", value: montant(devis.totalHT, devise) });
  totals.push({ label: `TVA (${devis.tvaRate} %)`, value: montant(devis.tva, devise) });
  totals.push({ label: "Total TTC", value: montant(devis.totalTTC, devise), emphasis: true });

  const definitif = input.definitif;
  const quand = input.valideLe ? ` le ${dateLongue(input.valideLe)}` : "";
  const mention = definitif
    ? `Devis définitif — validé par le client${quand}, au round ${input.round} sur ${input.roundsMax}.`
    : `Devis en cours de négociation — round ${input.round} sur ${input.roundsMax}. Ce document n'engage aucune des parties tant que le client ne l'a pas validé.`;

  const conditions: { label: string; value: string }[] = [
    { label: "Délai d'exécution", value: devis.delay || "Non précisé" },
    { label: "Nombre de postes", value: `${devis.lineItems.length}` },
  ];
  if (definitif && input.valideLe) {
    conditions.push({ label: "Validé le", value: dateLongue(input.valideLe) });
    conditions.push({
      label: "Validité du prix",
      value: `jusqu'au ${dateLongue(dateExpiration(input.valideLe, input.validiteJours))}`,
    });
  }

  const mentionsLegales = [
    "Les montants ci-dessus sont exprimés dans la devise de la mission et s'entendent toutes charges du prestataire comprises. Ils sont fermes pour la durée de validité indiquée.",
    "Chaque poste du présent devis constitue un livrable distinct : il fait l'objet d'une preuve d'exécution et d'une libération de fonds propre, selon le mode de financement retenu par le client à la publication de la mission.",
    "Les fonds sont séquestrés auprès d'un prestataire de paiement agréé. Flexwork instruit les libérations et ne détient jamais les fonds.",
    definitif
      ? "La validation de ce devis par le client arrête le prix de la prestation. Elle ne vaut pas contrat : seul le contrat de prestation, signé par les deux parties, engage leur exécution."
      : "Ce document est un état intermédiaire de la négociation, fourni à titre d'information. Il ne fixe aucun prix et n'ouvre aucun droit.",
  ];

  return {
    reference: devisReference(input.proposalId),
    titre: definitif ? "Devis définitif" : "Devis en négociation",
    missionTitre: input.missionTitre,
    mention,
    client: {
      name: input.client.name,
      roleLabel: input.client.roleLabel,
      lines: [
        { label: "Qualité", value: input.client.roleLabel },
        { label: "Adresse", value: input.client.adresse },
        { label: "Téléphone", value: input.client.tel },
        { label: "E-mail", value: input.client.email },
      ],
    },
    provider: {
      name: input.provider.name,
      roleLabel: input.provider.roleLabel,
      lines: [
        { label: "Qualité", value: input.provider.roleLabel },
        { label: "Adresse", value: input.provider.adresse },
        { label: "Téléphone", value: input.provider.tel },
        { label: "E-mail", value: input.provider.email },
      ],
    },
    lines,
    totals,
    conditions,
    notes: devis.notes?.trim() ?? "",
    mentionsLegales,
  };
}
