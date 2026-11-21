"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

// `session` est lu côté serveur (RootLayout, via auth()) et injecté ici — sans ça,
// useSession() démarre systématiquement en "loading" et refait son propre aller-retour
// /api/auth/session au montage de CHAQUE page, y compris le dashboard juste après
// validation de l'OTP. Le seeder ici l'évite : le statut "authenticated" est connu dès le
// premier rendu.
export function Providers({ children, session }: { children: React.ReactNode; session: Session | null }) {
  // refetchInterval : /api/auth/session est re-sondé toutes les 60s, ce qui repasse par le
  // callback jwt (src/auth.ts) et sa revérification en base — un onglet resté ouvert après
  // suppression/suspension du compte se voit donc déconnecté (status "unauthenticated",
  // UI mise à jour) en au plus une minute, sans attendre un focus de fenêtre ou une navigation.
  //
  // ⚠️ Conditionné à l'existence d'une session : un visiteur anonyme (pages publiques,
  // /signin, /signup, /verify-otp) n'a aucune session à invalider — le
  // re-sondage toutes les 60s était du travail purement gaspillé (aller-retour réseau + relu
  // en base via le callback jwt) sur CHAQUE page non connectée. Le poll ne sert qu'à
  // déconnecter automatiquement un compte supprimé/suspendu : cas qui n'existe que pour un
  // utilisateur déjà authentifié, qui, lui, continue de poller.
  return (
    <SessionProvider session={session} refetchInterval={session ? 60 : undefined}>
      {children}
    </SessionProvider>
  );
}
