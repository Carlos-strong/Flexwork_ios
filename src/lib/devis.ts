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
};

export type DevisLineItem = DevisLineItemInput & { total: number };

export type DevisData = {
  lineItems: DevisLineItem[];
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

// Une proposition dans l'un de ces statuts ne peut plus recevoir de devis.
export const CLOSED_PROPOSAL_STATUSES: ProposalStatus[] = [
  "acceptee",
  "refusee",
  "annulee_definitive",
  "devis_valide",
];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function computeDevisData(
  lineItems: DevisLineItemInput[],
  delay: string,
  notes: string,
  tvaRate: number
): DevisData {
  const items: DevisLineItem[] = lineItems.map((item) => ({
    ...item,
    total: round2(item.quantity * item.unitPrice),
  }));
  const totalHT = round2(items.reduce((sum, item) => sum + item.total, 0));
  const tva = round2(totalHT * (tvaRate / 100));
  const totalTTC = round2(totalHT + tva);
  return { lineItems: items, totalHT, tva, totalTTC, tvaRate, delay, notes };
}
