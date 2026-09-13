import type { KycDocStatus } from "@prisma/client";

// Les 4 types de documents du parcours KYC (US-201) — référence partagée entre la page
// /kyc, la file admin et la synchronisation d'état (scripts/sync-kyc-status.ts).
export const KYC_DOC_TYPES = ["piece_identite_recto", "piece_identite_verso", "selfie", "selfie_avec_piece"] as const;

// Dérive l'état global de validation KYC du compte (user.kycStatus) à partir de l'état réel
// de ses documents — "synchroniser l'état de la validation KYC du compte par rapport aux
// états des comptes créés". Utilisé par la décision par document, la décision de dossier et
// le script de réconciliation :
//   - un document rejete                   → "rejete" (dossier à reprendre)
//   - les 4 types présents ET tous verifie → "verifie"
//   - sinon (aucun / partiel / en attente) → "en_attente"
// NB : les comptes admin (isAdmin) n'ont pas de parcours documentaire — géré par l'appelant.
export function deriveKycStatus(docs: Array<{ type: string; status: KycDocStatus }>): "verifie" | "rejete" | "en_attente" {
  const statuses = docs.map((d) => d.status);
  const present = docs.map((d) => d.type);
  if (statuses.some((s) => s === "rejete")) return "rejete";
  if (KYC_DOC_TYPES.every((t) => present.includes(t)) && statuses.every((s) => s === "verifie")) return "verifie";
  return "en_attente";
}
