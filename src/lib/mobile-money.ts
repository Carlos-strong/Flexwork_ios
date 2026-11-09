// KYC financier — Mobile Money (2026-09-23).
//
// Arbitrage : « Pas d'IBAN — les paiements passent par PSP Mobile Money ». Aucun champ de ce
// genre n'existait en base : un prestataire pouvait signer, exécuter, voir son séquestre
// validé — et la plateforme n'avait nulle part où envoyer l'argent.
//
// Trois opérateurs couvrent la zone d'intervention : MTN, Moov et Celtiis (Bénin). La liste
// est fermée à dessein — un opérateur inconnu du PSP n'est pas payable, et l'accepter
// laisserait le prestataire croire qu'il est en règle.

export type MobileMoneyOperator = "mtn" | "moov" | "celtiis";

export type MobileMoneyOption = { value: MobileMoneyOperator; label: string };

// `as const` : `z.enum(MOBILE_MONEY_OPERATOR_VALUES)` doit produire l'union littérale
// attendue par la colonne `PayoutAccount.operator`.
export const MOBILE_MONEY_OPERATOR_VALUES = ["mtn", "moov", "celtiis"] as const;

export const MOBILE_MONEY_OPERATORS: MobileMoneyOption[] = [
  { value: "mtn", label: "MTN Mobile Money" },
  { value: "moov", label: "Moov Money" },
  { value: "celtiis", label: "Celtiis Cash" },
];

export function mobileMoneyOperatorLabel(value?: string | null): string {
  return MOBILE_MONEY_OPERATORS.find((o) => o.value === value)?.label ?? "Opérateur inconnu";
}

// Numéro au format international. On accepte les espaces et les tirets de saisie (« +229 96
// 12 34 56 ») mais on REFUSE de les normaliser : c'est le numéro tel que l'opérateur le
// reconnaîtra qui compte, et un reformatage automatique casserait un préfixe local.
const MOBILE_MONEY_NUMBER = /^\+?[0-9](?:[0-9\s.-]{6,22})[0-9]$/;

export function isValidMobileMoneyNumber(value: string): boolean {
  return MOBILE_MONEY_NUMBER.test(value.trim());
}

// ── Statut du dossier financier ───────────────────────────────────────────────────────────
// Pendant de `User.kycStatus` pour le dossier d'identité : deux dossiers, deux statuts, deux
// files d'instruction. Les fusionner ferait retomber un compte déjà vérifié à « en attente »
// au moindre justificatif de domicile encore en cours de lecture.

export const PAYOUT_STATUSES = ["non_renseigne", "en_attente", "verifie", "rejete"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  non_renseigne: "Non renseigné",
  en_attente: "En attente d'instruction",
  verifie: "Vérifié",
  rejete: "Rejeté",
};

/**
 * Le prestataire peut-il être payé ?
 *
 * Un seul état l'autorise : `verifie`. `non_renseigne` laisse signer et exécuter (le dossier
 * financier n'est pas une condition de candidature), mais aucun versement ne peut être
 * adressé à un compte dont l'opérateur n'a pas été contrôlé.
 */
export function isPayoutReady(status?: string | null): boolean {
  return status === "verifie";
}
