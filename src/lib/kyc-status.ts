import type { KycDocStatus } from "@prisma/client";

// Les 4 types de documents du parcours d'IDENTITÉ (US-201) — référence partagée entre la page
// /kyc, la file admin et la synchronisation d'état (scripts/sync-kyc-status.ts).
export const KYC_DOC_TYPES = ["piece_identite_recto", "piece_identite_verso", "selfie", "selfie_avec_piece"] as const;

// Types du dossier FINANCIER (2026-09-23). Rangés dans la même table `KycDocument` — même
// bucket privé, même URL signée, même écran d'instruction admin — mais ils ne comptent PAS
// dans l'état d'identité du compte. C'est tout l'objet de la séparation ci-dessous.
export const PAYOUT_DOC_TYPES = ["justificatif_domicile"] as const;

export function isIdentityDocType(type: string): boolean {
  return (KYC_DOC_TYPES as readonly string[]).includes(type);
}

export function isPayoutDocType(type: string): boolean {
  return (PAYOUT_DOC_TYPES as readonly string[]).includes(type);
}

// Dérive l'état global de validation KYC du compte (user.kycStatus) à partir de l'état réel
// de ses documents — "synchroniser l'état de la validation KYC du compte par rapport aux
// états des comptes créés". Utilisé par la décision par document, la décision de dossier et
// le script de réconciliation :
//   - un document d'identité rejete          → "rejete" (dossier à reprendre)
//   - les 4 types présents ET tous verifie   → "verifie"
//   - sinon (aucun / partiel / en attente)   → "en_attente"
// NB : les comptes admin (isAdmin) n'ont pas de parcours documentaire — géré par l'appelant.
//
// ⚠️ Les documents HORS identité (justificatif de domicile du dossier financier) sont ignorés
// (2026-09-23). Sans ce filtre, un justificatif encore en attente de lecture ferait retomber
// un compte DÉJÀ vérifié à « en attente » — la pièce d'identité aurait été validée, et le
// compte perdrait sa vérification à cause d'un document qui ne la concerne pas. Les deux
// dossiers ont deux files et deux décisions : identité (User.kycStatus) et versement
// (PayoutAccount.status).
export function deriveKycStatus(docs: Array<{ type: string; status: KycDocStatus }>): "verifie" | "rejete" | "en_attente" {
  const identityDocs = docs.filter((d) => isIdentityDocType(d.type));
  const statuses = identityDocs.map((d) => d.status);
  const present = identityDocs.map((d) => d.type);
  if (statuses.some((s) => s === "rejete")) return "rejete";
  if (KYC_DOC_TYPES.every((t) => present.includes(t)) && statuses.every((s) => s === "verifie")) return "verifie";
  return "en_attente";
}
