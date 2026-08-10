"use client";

import { SessionProvider } from "next-auth/react";
import type { Session } from "next-auth";

// `session` est lu côté serveur (RootLayout, via auth()) et injecté ici — sans ça,
// useSession() démarre systématiquement en "loading" et refait son propre aller-retour
// /api/auth/session au montage de CHAQUE page, y compris le dashboard juste après
// validation de l'OTP. Le seeder ici l'évite : le statut "authenticated" est connu dès le
// premier rendu.
export function Providers({ children, session }: { children: React.ReactNode; session: Session | null }) {
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
