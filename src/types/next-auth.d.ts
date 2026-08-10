import type { DefaultSession } from "next-auth";

// Augmente les types NextAuth v5 pour exposer id/role sur la session sans cast manuel
// répété dans chaque route (session.user.id / session.user.role).
// Note : le module `next-auth/jwt` n'a délibérément pas été augmenté ici — dans cette
// version beta, la fusion de déclaration ne s'applique pas au type du callback `jwt`
// (le token reste typé `{}` pour les champs custom malgré l'augmentation). Le callback
// jwt/session dans src/auth.ts caste donc localement plutôt que de dépendre de ça.
declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: string;
      isAdmin: boolean;
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
    isAdmin?: boolean;
  }
}
