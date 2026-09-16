// État financier d'un contrat (§3 du cahier des charges, 2026-09-14) — module FEUILLE, pur,
// sans aucun import de runtime.
//
// ── Pourquoi cet état est DÉRIVÉ et non stocké ─────────────────────────────────────────────
// Le cahier des charges propose un « état financier explicite » enchaînant NON_FINANCÉ →
// FINANCEMENT_EN_ATTENTE → SÉQUESTRÉ → PARTIELLEMENT_LIBÉRÉ → TOTALEMENT_LIBÉRÉ → CLÔTURÉ. Le
// réflexe serait d'ajouter une colonne au contrat et de la faire avancer.
//
// Ce serait un second point de vérité sur la même réalité. Les soldes, eux, sont déjà dérivés
// des instructions PSP (voir escrowBalance, src/lib/escrow.ts) : une colonne d'état pourrait
// contredire les mouvements qui la fondent, et rien ne signalerait la divergence — un webhook
// manqué, une transition oubliée sur un chemin nouveau, et l'écran affiche « séquestré » sur un
// contrat déjà payé. Même raisonnement que pour la retenue de garantie, jamais matérialisée en
// mouvement parce qu'elle est exactement calculable.
//
// Un état dérivé ne peut pas mentir : il EST la lecture des soldes, il n'en est pas le résumé.

export type EscrowFinancialState =
  /** Rien n'a jamais été versé, et rien n'est en route. */
  | "non_finance"
  /** Un débit est transmis au PSP, pas encore confirmé. Le client a pu déjà l'autoriser. */
  | "financement_en_attente"
  /** Les fonds sont là, rien n'est encore parti au prestataire. */
  | "sequestre"
  /** Une partie est partie, une autre reste — ou reste due. */
  | "partiellement_libere"
  /** Le séquestre est vidé, plus rien n'est dû ; le dossier n'est pas encore clos côté métier. */
  | "totalement_libere"
  /** Séquestre vidé, rien dû, et la mission a atteint un état terminal. */
  | "cloture";

// Les seuls statuts de mission qui ferment le dossier. `remboursee` en fait partie : un contrat
// dont le reliquat est rendu au client est clos, même si le prestataire n'a rien touché.
const TERMINAL_MISSION_STATUSES: readonly string[] = ["cloturee", "remboursee"];

/**
 * État financier déduit des soldes.
 *
 * @param missionStatus Sert UNIQUEMENT à distinguer « totalement libéré » de « clôturé ». Les
 *   deux décrivent le même séquestre — vide et sans reste dû ; ce qui les sépare n'est pas
 *   financier mais métier, et aucun solde ne peut le dire. Entre la dernière libération et la
 *   clôture il s'écoule le temps d'un webhook, parfois d'une médiation : afficher « clôturé »
 *   pendant cet intervalle annoncerait une fin qui n'est pas acquise.
 */
export function escrowFinancialState(
  balance: {
    funded: number;
    released: number;
    held: number;
    releasable: number;
    fundingPending: boolean;
  },
  missionStatus: string
): EscrowFinancialState {
  if (balance.funded <= 0) {
    return balance.fundingPending ? "financement_en_attente" : "non_finance";
  }

  // Des fonds sont encore là : seule compte alors la question « quelque chose est-il déjà
  // parti ? ». Un financement complémentaire en vol (recharge, §18) ne fait pas reculer l'état —
  // le contrat est financé, il l'est seulement insuffisamment, et c'est `releasable > available`
  // qui le dit, pas cet état.
  if (balance.held > 0) {
    return balance.released > 0 ? "partiellement_libere" : "sequestre";
  }

  // Séquestre vidé. S'il reste quelque chose de DÛ, le parcours n'est pas fini : c'est le cas
  // d'insuffisance (§18), où une validation attend sa recharge. « Totalement libéré » serait un
  // contresens — le prestataire attend encore.
  if (balance.releasable > 0) return "partiellement_libere";

  return TERMINAL_MISSION_STATUSES.includes(missionStatus) ? "cloture" : "totalement_libere";
}
