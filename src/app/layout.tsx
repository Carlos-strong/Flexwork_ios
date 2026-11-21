import type { Metadata } from "next";
import { IBM_Plex_Sans, Sora } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { UserIdentityProvider } from "@/components/user-identity";
import { auth } from "@/auth";
import { getPublishedFrontendConfig, resolveMenu, resolveSetting } from "@/lib/frontend-config";
import SiteHeader from "@/components/SiteHeader";

// Polices du modèle UI/UX « Marketplace Escrow » (2026-11-11) : IBM Plex Sans pour le texte,
// Sora pour les titres et les montants clés (classes .font-display / .font-fraunces, globals.css).
const body = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

const display = Sora({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

// Titre et description viennent des réglages publiés (module « Référencement global » de
// /backoffice/content). `generateMetadata` remplace l'objet statique : c'est la seule façon, dans
// l'App Router, de composer des métadonnées à partir d'une lecture asynchrone.
//
// Le reste — manifeste, icônes, réglages d'application web — n'est PAS éditable : ce sont des
// fichiers servis par le déploiement, et une console qui prétendrait les changer ne pourrait
// pas tenir sa promesse.
export async function generateMetadata(): Promise<Metadata> {
  const config = await getPublishedFrontendConfig();
  return {
    title: resolveSetting(config, "seo.title"),
    description: resolveSetting(config, "seo.description"),
    manifest: "/manifest.json",
    icons: {
      icon: "/favicon.ico",
      apple: "/icon.svg",
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: resolveSetting(config, "site.name"),
    },
    other: {
      "mobile-web-app-capable": "yes",
    },
  };
}

export const viewport = {
  themeColor: "#4C1D95",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [session, config] = await Promise.all([auth(), getPublishedFrontendConfig()]);

  return (
    <html lang="fr">
      <body className={`overflow-x-hidden ${body.variable} ${display.variable}`}>
        <Providers session={session}>
          <UserIdentityProvider>
            {/* Barre de navigation globale, identique sur toutes les pages (sauf consoles
                d'administration et écrans d'authentification — voir SiteHeader). */}
            <SiteHeader exploreLinks={resolveMenu(config, "header_explore")} />
            {children}
          </UserIdentityProvider>
        </Providers>
      </body>
    </html>
  );
}
