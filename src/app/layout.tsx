import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { UserIdentityProvider } from "@/components/user-identity";
import { auth } from "@/auth";
import { getPublishedFrontendConfig, resolveSetting } from "@/lib/frontend-config";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Police d'affichage réservée aux montants clés (total contrat, net versé, montant d'offre)
// — jamais au texte courant. Utilisation : className="font-fraunces" (voir globals.css).
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-fraunces",
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
  themeColor: "#008751",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();

  return (
    <html lang="fr">
      <body className={`overflow-x-hidden ${inter.variable} ${fraunces.variable}`}>
        <Providers session={session}>
          <UserIdentityProvider>
            {children}
          </UserIdentityProvider>
        </Providers>
      </body>
    </html>
  );
}
