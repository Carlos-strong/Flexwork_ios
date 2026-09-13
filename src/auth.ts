import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/lib/db";
import { verifyOtp } from "@/lib/otp";
import type { OtpPurpose } from "@prisma/client";

// Le secret signe/chiffre les JWT de session — quiconque le connaît peut forger une
// session valide pour n'importe quel compte. Refuser explicitement de démarrer en
// production avec le placeholder par défaut plutôt que de le laisser passer en silence.
if (
  process.env.NODE_ENV === "production" &&
  (!process.env.AUTH_SECRET || process.env.AUTH_SECRET === "change-me-in-each-environment")
) {
  throw new Error(
    "AUTH_SECRET manquant ou laissé à sa valeur placeholder en production — générer un secret propre à cet environnement avant de démarrer."
  );
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: { signIn: "/signin" },
  providers: [
    Credentials({
      // `id` pilote le routage (signIn("otp", …), /api/auth/callback/otp) — `name` n'est
      // qu'un libellé d'affichage. Sans `id` explicite, Auth.js v5 retombe sur le type de
      // provider ("credentials"), et tout appel signIn("otp", …) échoue silencieusement
      // avec error=Configuration : aucune connexion n'aboutissait avant ce correctif.
      id: "otp",
      name: "otp",
      credentials: {
        identifier: { label: "Email ou téléphone", type: "text" },
        code: { label: "Code OTP", type: "text" },
        purpose: { label: "purpose", type: "text" },
      },
      async authorize(credentials) {
        const identifier = credentials?.identifier as string | undefined;
        const code = credentials?.code as string | undefined;
        const purpose = (credentials?.purpose as OtpPurpose | undefined) ?? "login";

        if (!identifier || !code) return null;

        // Plutôt qu'un findFirst avec OR (qui peut bypasser l'index unique),
        // on cible directement le bon champ selon que l'identifiant contient un @.
        // On utilise `select` pour ne lire que les colonnes nécessaires au retour,
        // au lieu de toutes les colonnes User (dont les relations).
        const user = await prisma.user.findFirst({
          where: identifier.includes("@")
            ? { email: identifier }
            : { tel: identifier },
          select: { id: true, email: true, tel: true, role: true, status: true, isAdmin: true },
        });
        if (!user) return null;

        // `status` (actif/suspendu/banni) était vérifié nulle part avant ce correctif —
        // un compte suspendu/banni pouvait se (re)connecter normalement. Refuser la
        // connexion ici, au point d'authentification, quel que soit le canal.
        if (user.status !== "active") return null;

        const result = await verifyOtp({ userId: user.id, purpose, code });
        if (!result.ok) return null;

        // Seul le canal réellement vérifié est marqué comme tel — l'OTP de signup part par
        // e-mail (src/lib/otp.ts), le téléphone n'est donc pas confirmé par ce même code.
        // Le fixer à `true` ici affirmerait une vérification SMS qui n'a jamais eu lieu.
        if (purpose === "signup") {
          await prisma.user.update({
            where: { id: user.id },
            data: { emailVerified: new Date() },
          });
        }

        return { id: user.id, email: user.email, name: user.tel, role: user.role, isAdmin: user.isAdmin };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      const t = token as typeof token & { id?: string; role?: string; isAdmin?: boolean };
      if (user) {
        t.id = user.id;
        t.role = (user as typeof user & { role?: string }).role;
        t.isAdmin = (user as typeof user & { isAdmin?: boolean }).isAdmin ?? false;
        return t;
      }

      // Requête sur un token déjà émis (pas un signIn) — le JWT est stateless et signé :
      // sans cette revérification, un compte supprimé ou suspendu APRÈS l'émission du
      // token resterait « connecté » jusqu'à expiration du cookie (jusqu'à 30 jours),
      // pour toutes les routes qui ne font que lire la session sans retoucher la base.
      // Retourner `null` ici fait effacer le cookie de session par Auth.js
      // (@auth/core/lib/actions/session.js) et rend auth() null partout dans l'app dès
      // la requête suivante — déconnexion automatique de toute session dont le compte
      // n'existe plus ou n'est plus actif (suspendu/banni).
      if (!t.id) return null;

      const dbUser = await prisma.user.findUnique({
        where: { id: t.id },
        select: { status: true, role: true, isAdmin: true },
      });
      if (!dbUser || dbUser.status !== "active") return null;

      // Rafraîchit rôle/isAdmin depuis la base à chaque requête : une promotion/
      // rétrogradation admin ou un changement de rôle prend effet immédiatement,
      // sans attendre l'expiration du JWT existant.
      t.role = dbUser.role;
      t.isAdmin = dbUser.isAdmin;
      return t;
    },
    async session({ session, token }) {
      const t = token as typeof token & { id?: string; role?: string; isAdmin?: boolean };
      if (session.user && t.id) {
        session.user.id = t.id;
        session.user.role = t.role ?? "client";
        session.user.isAdmin = t.isAdmin ?? false;
      }
      return session;
    },
  },
});
