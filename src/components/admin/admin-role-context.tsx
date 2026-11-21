"use client";

import { createContext, useContext } from "react";
import type { AdminRole } from "@prisma/client";
import { canActInModule } from "@/lib/admin-roles";

/**
 * Rôle de l'administrateur connecté, rendu disponible à ses écrans.
 *
 * Le rôle n'est pas dans le JWT (`src/auth.ts` ne transporte que `id`/`role`/`isAdmin`) : il
 * est lu en base par le layout serveur `/admin/layout.tsx`, puis passé ici une seule fois.
 * Sans ce contexte, chaque écran qui veut masquer un geste devrait refaire un appel d'API
 * pour redécouvrir ce que le serveur savait déjà — et un écran qui ne masque pas son geste
 * affiche un bouton qui échoue en 403.
 */
const AdminRoleContext = createContext<AdminRole | null>(null);

export function AdminRoleProvider({ role, children }: { role: AdminRole; children: React.ReactNode }) {
  return <AdminRoleContext.Provider value={role}>{children}</AdminRoleContext.Provider>;
}

/** Rôle de l'admin connecté, ou `null` hors des coquilles `/admin` et `/backoffice`. */
export function useAdminRole(): AdminRole | null {
  return useContext(AdminRoleContext);
}

/**
 * L'admin connecté a-t-il le geste métier de cette rubrique (ou de cette sous-rubrique) ?
 * Faux quand le rôle est inconnu (hors coquille) : on ferme, on n'ouvre pas par défaut.
 */
export function useCanActIn(moduleId: string, subId?: string): boolean {
  const role = useAdminRole();
  if (!role) return false;
  return canActInModule(moduleId, role, subId);
}

/** Vrai si la rubrique est affichée en consultation seule pour le rôle courant. */
export function useIsReadOnly(moduleId: string, subId?: string): boolean {
  const role = useAdminRole();
  if (!role) return false;
  return !canActInModule(moduleId, role, subId);
}
