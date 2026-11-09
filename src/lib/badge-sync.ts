"use client";

// Bus d'invalidation léger pour resynchroniser IMMÉDIATEMENT les badges du sidebar
// (useSidebarBadges, useDevisContratsBadges) et la cloche de notifications
// (NotificationsBell) après une action locale qui change leur valeur — envoi d'un message,
// réponse à une offre, validation/rejet d'un jalon ou d'un devis, etc. — au lieu d'attendre
// le prochain poll (30s) ou un refocus de fenêtre (window "focus").
//
// Analyse (2026-09-04) : chaque hook de badge tournait déjà en polling 30s + focus, mais
// AUCUN des points d'action qui changent réellement ces compteurs (répondre à une offre,
// valider un jalon, envoyer un message…) ne les notifiait — un utilisateur qui répond à une
// offre puis reste sur la même page voyait le badge "Offres" du sidebar rester faux jusqu'à
// 30s. Un CustomEvent DOM plutôt qu'un contexte React : émetteurs (zone de chat, tiroir
// d'offre…) et auditeurs (sidebar, cloche) vivent dans des sous-arbres différents de
// DashboardLayout sans ancêtre commun pratique pour un contexte.
const EVENT = "flexwork:badges-should-refresh";

/** À appeler juste après le succès d'une action qui change un compteur de badge
 *  (sidebar ou cloche) alors que l'utilisateur reste sur la même page — sans quoi le badge
 *  n'est mis à jour qu'au prochain poll (30s) ou refocus de fenêtre. */
export function refreshBadges() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
}

/** Écoute les demandes de resynchronisation immédiate. Retourne la fonction de nettoyage. */
export function onBadgesShouldRefresh(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
