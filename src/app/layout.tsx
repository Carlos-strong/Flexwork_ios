import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { UserIdentityProvider } from "@/components/user-identity";
import { auth } from "@/auth";

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

export const metadata: Metadata = {
  title: "FlexWork — Talents vérifiés, zéro arnaque",
  description:
    "FlexWork met en relation clients et prestataires en Afrique de l'Ouest. Identité vérifiée, paiement sécurisé.",
  manifest: "/manifest.json",
  icons: {
    icon: "/favicon.ico",
    apple: "/icon.svg",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FlexWork",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

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
