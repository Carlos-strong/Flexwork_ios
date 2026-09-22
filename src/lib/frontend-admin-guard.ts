import { requireAdminRole, requireAnyAdminRole } from "@/lib/adminGuard";

/**
 * Édition du contenu public : réservée au rôle `frontend` (§13 — séparation des pouvoirs).
 *
 * Le superviseur n'écrit PAS ici, alors qu'il lit tout. Ce n'est pas un oubli : sa fonction
 * est de contrôler, et un contrôleur qui peut réécrire ce qu'il contrôle n'en est plus un.
 * La règle vaut déjà pour les gestes KYC et les gestes de médiation — lire n'est pas agir.
 */
export function requireFrontendEditor() {
  return requireAdminRole("frontend");
}

/** Lecture des écrans d'administration du frontend : l'éditeur et le superviseur. */
export function requireFrontendReader() {
  return requireAnyAdminRole(["frontend", "superviseur"]);
}
