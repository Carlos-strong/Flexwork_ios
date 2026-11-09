// Signal navigateur « le séquestre de cette page a bougé » (2026-09-15).
//
// Plusieurs panneaux lisent le même séquestre sur un même écran — le compte, les relevés de
// présence. Un geste fait dans l'un (constater un relevé, clôturer un chantier) change les
// chiffres de l'autre ; sans ce signal, l'écran affichait deux états contradictoires jusqu'au
// prochain rechargement. Un événement plutôt qu'un contexte React : les panneaux sont montés par
// des pages différentes et n'ont pas d'ancêtre commun à qui confier l'état.
export const ESCROW_CHANGED_EVENT = "flexwork:escrow-changed";

export function notifyEscrowChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(ESCROW_CHANGED_EVENT));
}
