import type { DevisDraft } from "@/lib/devis-draft";
import type { ProposalDraft } from "@/lib/proposal-draft";

// Brouillon SERVEUR → formulaire (2026-11-09). Une candidature retenue faute de KYC est
// enregistrée côté serveur sous la forme de la requête à envoyer (src/lib/proposal-drafts.ts) ;
// sur un autre appareil, le formulaire la retrouve en la reconvertissant dans la forme des
// brouillons locaux qu'il sait déjà restaurer.

type Payload = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/** Candidature à prix fixe / au temps. Au temps, le formulaire saisit le TARIF (`unitRate`). */
export function proposalDraftFromPayload(payload: Payload): Omit<ProposalDraft, "savedAt"> {
  return {
    montant: num(payload.unitRate) ?? num(payload.montant) ?? 0,
    delaiPropose: num(payload.delaiPropose),
    message: str(payload.message) ?? "",
    financingModeKey: str(payload.financingModeKey),
  };
}

// La date de début n'a pas de champ serveur : la page devis l'écrit en tête des notes
// (« Date de début souhaitée : jj/mm/aaaa », puis une ligne vide).
const START_DATE_PREFIX = /^Date de début souhaitée : (\d{2})\/(\d{2})\/(\d{4})\n\n/;

/** Devis (mission sur devis). */
export function devisDraftFromPayload(payload: Payload): Omit<DevisDraft, "savedAt"> {
  const notes = str(payload.notes) ?? "";
  const m = notes.match(START_DATE_PREFIX);
  const lineItems = Array.isArray(payload.lineItems)
    ? (payload.lineItems as Payload[]).map((l) => ({
        description: str(l.description) ?? "",
        quantity: num(l.quantity) ?? 1,
        unit: str(l.unit) ?? "forfait",
        unitPrice: num(l.unitPrice) ?? 0,
        echeance: str(l.echeance),
      }))
    : [];
  return {
    lineItems,
    delay: str(payload.delay) ?? "",
    dateDebut: m ? `${m[3]}-${m[2]}-${m[1]}` : undefined,
    notes: m ? notes.slice(m[0].length) : notes,
    tvaRate: num(payload.tvaRate) ?? 0,
    laborCost: num(payload.laborCost) ?? 0,
    financingModeKey: str(payload.financingModeKey),
  };
}
