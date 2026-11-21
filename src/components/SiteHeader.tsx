"use client";

import { usePathname } from "next/navigation";
import Header, { type ExploreLink } from "@/components/afrilance/Header";

// Barre de navigation globale (2026-11-09) — la MÊME sur toutes les pages, montée une seule
// fois par le layout racine (src/app/layout.tsx). Avant, seules l'accueil et /recherche
// l'affichaient ; les tableaux de bord avaient leur propre barre et un sidebar, et une
// trentaine de pages (profils, services, KYC, nouvelle mission, fiche mission, pages
// d'information…) n'avaient aucune barre du tout.
//
// Exceptions, qui ont chacune leur propre écran complet :
//   - /admin, /backoffice : consoles d'administration (leur propre gabarit) ;
//   - /signin, /signup, /verify-otp : parcours d'authentification en plein écran ;
//   - /psp-sandbox : simule la page d'un prestataire de paiement EXTERNE — la barre de
//     Flexwork n'a pas à y figurer.
const WITHOUT_SITE_HEADER = ["/admin", "/backoffice", "/signin", "/signup", "/verify-otp", "/psp-sandbox"];

export function hasSiteHeader(pathname: string): boolean {
  return !WITHOUT_SITE_HEADER.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default function SiteHeader({ exploreLinks }: { exploreLinks?: ExploreLink[] }) {
  const pathname = usePathname() ?? "/";
  if (!hasSiteHeader(pathname)) return null;
  return <Header exploreLinks={exploreLinks} />;
}
