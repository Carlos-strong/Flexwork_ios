import type { ProposalStatus } from "@prisma/client";

// Logique pure de la négociation de devis BTP (missions budgetType = "QUOTE").
// Calculs et constantes partagés, testables une seule fois, réutilisés par
// POST /api/missions/[id]/devis, POST /api/missions/[id]/proposals/[id]/devis/validate
// et le cron d'expiration — même approche que src/lib/jalons.ts (montants Float dans la
// devise de la mission, jamais de centimes).

export type DevisLineItemInput = {
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  // Échéance indicative de CE jalon (texte libre, ex. "15/09/2026" ou "Semaine 3") — purement
  // informatif, ne participe à aucun calcul ni à aucune contrainte de planification réelle.
  echeance?: string;
};

export type DevisLineItem = DevisLineItemInput & { total: number };

export type DevisData = {
  lineItems: DevisLineItem[];
  // Rubrique séparée des jalons (matériaux/prestations) : un devis BTP distingue
  // classiquement le coût des matériaux/fournitures de la main d'œuvre appliquée dessus —
  // les deux s'additionnent avant TVA, mais ne se mélangent pas dans les jalons ci-dessus
  // pour rester lisibles séparément (US demandée : rubrique "Main d'œuvre" dédiée).
  laborCost: number;
  totalHT: number;
  tva: number;
  totalTTC: number;
  tvaRate: number;
  delay: string;
  notes: string;
};

// Une proposition dans l'un de ces statuts empêche toute nouvelle négociation de devis
// ailleurs (exclusivité d'une candidature active par prestataire).
export const ACTIVE_NEGOCIATION_STATUSES: ProposalStatus[] = [
  "en_negociation",
  "devis_valide",
  "acceptee",
];

// …MAIS seulement tant que la mission correspondante est en cours. Une proposition retenue
// reste `devis_valide`/`acceptee` pour toujours — aucune route ne l'en fait sortir, et la
// clôture (src/lib/psp-webhook.ts) ne touche jamais la proposition. Sans cette seconde
// condition, l'exclusivité n'était donc JAMAIS levée : un prestataire ayant mené une mission
// à son terme se retrouvait définitivement interdit de candidater ailleurs.
//
// La mission, elle, porte un état terminal fiable — c'est donc elle qu'on interroge, plutôt
// que de réécrire après coup un statut de proposition dont la valeur historique (« cette
// candidature a été retenue ») doit rester vraie. `validee` y figure au même titre que
// `cloturee` : tous les jalons sont payés, seule la retenue de garantie est encore en vol
// (mode J4), et le prestataire n'a plus rien à y faire.
export const EXCLUSIVITY_RELEASING_MISSION_STATUSES = ["cloturee", "validee"] as const;

// Une proposition dans l'un de ces statuts ne peut plus recevoir de devis.
export const CLOSED_PROPOSAL_STATUSES: ProposalStatus[] = [
  "acceptee",
  "refusee",
  "annulee_definitive",
  "devis_valide",
];

// La toute première soumission d'un devis est toujours permise (ce n'est pas une révision).
// Une fois un devis déjà présent, le prestataire ne peut en resoumettre un nouveau round que
// si le client a explicitement demandé une révision — POST .../devis/request-revision. Sans
// ça, la carte "Réviser le devis" restait visible en permanence côté prestataire, qui pouvait
// resoumettre à volonté sans qu'aucune demande du client ne l'ait jamais motivé.
export function canProviderReviseDevis(input: { hasDevis: boolean; revisionRequested: boolean }): boolean {
  return !input.hasDevis || input.revisionRequested;
}

// Statuts "ouverts" — une négociation existe et peut encore bouger (révision, rejet,
// acceptation). "envoyee" y figure pour la négociation prix fixe/taux (src/app/api/missions/
// [id]/proposals/route.ts) : sa toute première soumission reste "envoyee" (accord immédiat
// possible sans passer par une négociation, comme avant), mais le client doit pouvoir
// demander une révision ou rejeter dès ce premier round, pas seulement à partir du round 2 —
// sinon aucune négociation ne peut jamais démarrer. Sans effet sur le mode devis (QUOTE) :
// sa première soumission (POST /api/missions/[id]/devis) passe toujours directement par
// "en_negociation", jamais par "envoyee" avec un devisData renseigné.
const OPEN_NEGOTIATION_STATUSES: ProposalStatus[] = ["envoyee", "en_negociation"];

// Le client ne peut demander une révision que s'il y a déjà un devis/prix à réviser, la
// négociation est toujours ouverte, et il n'y a pas déjà une demande en attente (évite les
// demandes dupliquées empilées avant que le prestataire n'ait eu l'occasion de répondre).
export function canClientRequestRevision(input: {
  hasDevis: boolean;
  status: ProposalStatus;
  revisionAlreadyRequested: boolean;
}): boolean {
  return input.hasDevis && OPEN_NEGOTIATION_STATUSES.includes(input.status) && !input.revisionAlreadyRequested;
}

// Le client ne peut rejeter explicitement un devis/prix que pendant une négociation ouverte —
// une fois validé, accepté, refusé ou annulé, il n'y a plus rien à rejeter. Contrairement à
// canClientRequestRevision, ne dépend pas d'une demande déjà en attente (le rejet met fin à
// la négociation, il ne se répète pas).
export function canClientRejectDevis(status: ProposalStatus): boolean {
  return OPEN_NEGOTIATION_STATUSES.includes(status);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Principe de calcul : Total HT = sous-total des jalons (Σ quantité × prix unitaire) +
// Main d'œuvre (rubrique forfaitaire saisie séparément). La TVA et le Total TTC s'appliquent
// ensuite sur ce Total HT déjà enrichi de la main d'œuvre — pas sur les seuls jalons — pour
// qu'un devis reste cohérent avec sa présentation (rien n'est tacitement exonéré de TVA).
export function computeDevisData(
  lineItems: DevisLineItemInput[],
  delay: string,
  notes: string,
  tvaRate: number,
  laborCost = 0
): DevisData {
  const items: DevisLineItem[] = lineItems.map((item) => ({
    ...item,
    total: round2(item.quantity * item.unitPrice),
  }));
  const itemsSubtotal = items.reduce((sum, item) => sum + item.total, 0);
  const totalHT = round2(itemsSubtotal + laborCost);
  const tva = round2(totalHT * (tvaRate / 100));
  const totalTTC = round2(totalHT + tva);
  return { lineItems: items, laborCost: round2(laborCost), totalHT, tva, totalTTC, tvaRate, delay, notes };
}
