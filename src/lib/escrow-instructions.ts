import type { EscrowInstructionType, PspOperationStatus } from "@prisma/client";

// Vocabulaire partagé des instructions d'escrow — module FEUILLE, sans aucun import de runtime
// (seulement des types Prisma, effacés à la compilation).
//
// Pourquoi un fichier à part plutôt que ces constantes dans src/lib/escrow.ts : escrow.ts
// importe psp-virtual.ts, qui importe psp-webhook.ts, qui importe escrow.ts. Ce cycle existe
// déjà et fonctionne, mais y accrocher de nouvelles dépendances (psp-virtual → escrow) le
// resserrerait en cycle direct. Un module feuille est importable par n'importe lequel des trois
// sans rien refermer.

// Une instruction « en vol » (transmise, pas encore tranchée par le PSP) ou « aboutie » compte
// de la même façon dans tous les cumuls financiers : seul `failed` est exclu, pour qu'une
// instruction refusée puisse être reprise sans amputer le solde restant (voir le commentaire
// détaillé de totalReleasedAmount, src/lib/escrow.ts).
export const IN_FLIGHT_STATUSES: PspOperationStatus[] = ["pending", "confirmed"];

// Tout ce qui SORT du séquestre vers le prestataire. `retention_release` (règle 18.10) est un
// type distinct de `release` pour ne pas se confondre avec les libérations de médiation, qui
// partagent son scope — mais du point de vue de l'argent versé, les deux comptent pareil.
// Oublier le second ferait disparaître la retenue des gains affichés au prestataire alors
// qu'elle lui a bien été payée.
export const PROVIDER_PAYOUT_TYPES: EscrowInstructionType[] = ["release", "retention_release"];

export function isProviderPayout(instructionType: string): boolean {
  return (PROVIDER_PAYOUT_TYPES as string[]).includes(instructionType);
}
