"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useSession } from "next-auth/react";

// Identité de l'utilisateur connecté, chargée UNE fois au niveau racine puis partagée par
// contexte. Avant ce fichier, chaque page de rubrique du dashboard re-fetchait son identité
// (via provider-summary / client-summary) à CHAQUE montage — donc à chaque clic dans le
// sidebar : le bloc utilisateur (bas de sidebar + navbar) retombait sur le fallback
// ("CL"/"Client" ou "…") pendant le chargement, voire restait bloqué sur un échec transitoire
// en navigation rapide. En déplaçant le chargement ici, il n'est PLUS lié aux clics de
// rubrique : une seule requête légère (/api/users/me) par session, réutilisée partout.

export type UserIdentity = {
  id: string;
  name: string;
  initials: string;
  avatarUrl: string | null;
  // Exigence de garant activée par l'Admin KYC pour ce compte (défaut false) — pilote
  // l'affichage « Requis / Optionnel » des vues prestataire.
  garantRequired: boolean;
};

type MePayload = {
  firstname?: string | null;
  lastname?: string | null;
  fullName?: string | null;
  avatarUrl?: string | null;
  garantRequired?: boolean;
};

function initialsOf(firstname?: string | null, lastname?: string | null): string {
  const a = firstname?.trim().charAt(0) ?? "";
  const b = lastname?.trim().charAt(0) ?? "";
  return `${a}${b}`.toUpperCase();
}

// Nom affiché cohérent avec les anciens summaries (provider → prénom seul, client →
// prénom + initiale du nom), pour ne pas changer le rendu existant.
function displayName(role: string | undefined, d: MePayload): string {
  const first = d.firstname?.trim();
  const last = d.lastname?.trim();
  if (role === "client") {
    const lastInitial = last?.charAt(0);
    if (first && lastInitial) return `${first} ${lastInitial}.`;
    return first || last || "Client";
  }
  return first || last || "Prestataire";
}

const UserIdentityContext = createContext<UserIdentity | null>(null);

export function UserIdentityProvider({ children }: { children: ReactNode }) {
  const { data: session, status } = useSession();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  const role = (session?.user as { role?: string } | undefined)?.role;
  const [identity, setIdentity] = useState<UserIdentity | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !userId) {
      setIdentity(null);
      return;
    }
    let cancelled = false;
    fetch("/api/users/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: MePayload | null) => {
        if (cancelled || !d) return;
        setIdentity({
          id: userId,
          name: displayName(role, d),
          initials: initialsOf(d.firstname, d.lastname) || "U",
          avatarUrl: d.avatarUrl ?? null,
          garantRequired: d.garantRequired ?? false,
        });
      })
      .catch(() => {
        // Échec silencieux — les vues retombent sur les initiales, pas de blocage d'UI.
      });
    return () => {
      cancelled = true;
    };
  }, [status, userId, role]);

  return <UserIdentityContext.Provider value={identity}>{children}</UserIdentityContext.Provider>;
}

export function useUserIdentity(): UserIdentity | null {
  return useContext(UserIdentityContext);
}
