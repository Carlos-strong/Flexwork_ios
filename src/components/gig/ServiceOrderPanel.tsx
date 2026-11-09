"use client";

// Formules + « Commander » de la page publique d'un service (/services/[id]), 2026-11-08.
//
// Commander mène à la rubrique Offres du client, formule présélectionnée. Un visiteur passe
// d'abord par la connexion (la rubrique l'y envoie avec `callbackUrl`) puis revient sur ce
// service : regarder un service ne demande plus de compte, commander si.
//
// « Commander » est un LIEN, et le choix de la formule des boutons radio (GigPackages) : la page
// fonctionne avant même que ses scripts soient chargés.

import { GigPackages } from "@/components/gig/GigPackages";
import type { GigPackageView } from "@/lib/gig-serialize";

export function ServiceOrderPanel({
  gigId,
  packages,
  currency,
  fallback,
}: {
  gigId: string;
  packages: GigPackageView[];
  currency: string;
  fallback: { prix: number; delaiJours: number };
}) {
  return (
    <GigPackages
      packages={packages}
      currency={currency}
      fallback={fallback}
      orderHref={(tier) => `/client/offres?gig=${encodeURIComponent(gigId)}${tier ? `&tier=${tier}` : ""}`}
    />
  );
}
