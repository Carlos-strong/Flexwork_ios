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

// ── Règle de solde séquestré ───────────────────────────────────────────────────────────────
// Combien reste-t-il réellement au séquestre, à partir des cumuls d'instructions ?
//
// Fonction PURE et partagée par les DEUX tables d'opérations : `PspEscrowOperation` (missions,
// via heldBalance/escrowBalance) et `GigOrderEscrowOperation` (commandes Gig, via
// gigHeldBalance). Les deux portent les mêmes colonnes et le même enum ; la règle n'a jamais eu
// de raison d'être écrite deux fois.
//
// ── L'ASYMÉTRIE entrant / sortant (2026-09-14) ─────────────────────────────────────────────
// Le statut d'une instruction ne se lit PAS de la même façon selon son sens, et cette asymétrie
// est la règle la plus importante de ce fichier :
//
//   - un HOLD ne crédite qu'une fois `confirmed`. Une mise sous séquestre `pending` est un débit
//     Mobile Money transmis, PAS un encaissement : le client peut ne jamais l'autoriser. La
//     compter reviendrait à autoriser un paiement au prestataire contre de l'argent qui n'est
//     pas arrivé — exactement ce que l'invariant n°1 du cahier des charges interdit (« aucun
//     paiement prestataire ne peut être exécuté si les fonds n'ont pas été préalablement placés
//     sous séquestre »).
//
//   - tout ce qui SORT débite dès qu'il est `pending`. Une libération transmise n'est pas encore
//     confirmée, mais elle est partie : ne pas la compter reviendrait à pouvoir la réémettre, et
//     à sortir deux fois la même somme (règle 18.3, voir le commentaire de releasedAmounts dans
//     src/lib/escrow.ts).
//
// Les deux branches penchent donc du même côté — ne jamais surestimer ce dont on dispose — et
// c'est ce qui rend ce solde utilisable comme borne d'un paiement.
//
// `freeze` et `unfreeze` restent NEUTRES dans les deux cas : ni l'un ni l'autre ne déplace de
// fonds, ils ouvrent et referment seulement la parenthèse pendant laquelle les fonds ne peuvent
// pas bouger. Les sommes litigieuses restent donc comptées au séquestre, ce qui est exactement
// ce qu'on attend d'elles ; leur INDISPONIBILITÉ se lit ailleurs (voir `EscrowBalance.blocked`,
// src/lib/escrow.ts).
//
// Prend des lignes déjà agrégées (un `groupBy` par type ET par statut) plutôt que les opérations
// une à une : c'est la forme sous laquelle la base sait répondre le moins cher.
//
// PRÉCONDITION : les lignes passées ne contiennent AUCUNE instruction `failed`. Une instruction
// refusée par le PSP n'a jamais quitté le séquestre et doit pouvoir être reprise sans amputer le
// solde (voir IN_FLIGHT_STATUSES ci-dessus). Tous les appelants l'obtiennent par le `where` de
// leur agrégat ; celui qui liste d'abord et calcule ensuite doit filtrer lui-même.
export function netHeldAmount(
  rows: { instructionType: string; status: string; amount: number }[]
): number {
  let held = 0;
  for (const row of rows) {
    if (row.instructionType === "freeze" || row.instructionType === "unfreeze") continue;
    if (row.instructionType === "hold") {
      if (row.status === "confirmed") held += row.amount;
    } else {
      held -= row.amount;
    }
  }
  return held;
}

// ── Part GELÉE encore en vigueur ───────────────────────────────────────────────────────────
// `freeze` ouvre la parenthèse, `unfreeze` la referme : ce qui reste bloqué est la différence.
// Aucun des deux ne déplace de fonds (voir netHeldAmount) — cette fonction ne dit donc pas ce
// qui est SORTI, mais ce qui ne peut PAS sortir.
//
// Extraite ici (2026-09-14) parce qu'elle était écrite deux fois dans src/lib/escrow.ts et
// qu'un troisième appelant arrivait, côté commandes Gig. Une règle financière recopiée trois
// fois finit par diverger — c'est exactement ce qui était arrivé au calcul de solde de la
// console PSP virtuelle, qui comptait un gel comme un crédit.
//
// Même précondition que `netHeldAmount` : aucune instruction `failed` dans les lignes passées.
export function outstandingFreeze(rows: { instructionType: string; amount: number }[]): number {
  let bloque = 0;
  for (const row of rows) {
    if (row.instructionType === "freeze") bloque += row.amount;
    else if (row.instructionType === "unfreeze") bloque -= row.amount;
  }
  return Math.max(0, bloque);
}
