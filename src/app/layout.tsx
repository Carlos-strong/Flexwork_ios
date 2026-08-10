import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Nav } from "@/components/nav";
import { auth } from "@/auth";

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
      <body className="overflow-x-hidden">
        <Providers session={session}>
          <Nav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
