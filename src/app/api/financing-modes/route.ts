import { NextResponse } from "next/server";
import { listFinancingModes, DEFAULT_FINANCING_MODE_KEY } from "@/lib/financing-modes";

// Catalogue des modes de financement (2026-09-10) — alimente le sélecteur de /missions/new et
// l'écran de génération de contrat. Publique et sans effet de bord : c'est une table de
// référence, pas une donnée de mission.
//
// Les modes INDISPONIBLES sont renvoyés eux aussi, avec leur motif : le client doit pouvoir
// voir qu'un mode existe et pourquoi il ne lui est pas encore proposé, plutôt que de se
// demander si la plateforme l'a oublié. C'est l'UI qui les grise.
export async function GET() {
  return NextResponse.json({
    defaultKey: DEFAULT_FINANCING_MODE_KEY,
    modes: listFinancingModes().map((m) => ({
      key: m.key,
      family: m.family,
      label: m.label,
      badge: m.badge,
      definition: m.definition,
      recommendation: m.recommendation,
      available: m.available,
      unavailableReason: m.unavailableReason ?? null,
      // Exposé pour que l'UI puisse expliquer le comportement concret sans dupliquer la
      // table (« fractionné en jalons », « libération au fil des points d'étape »…).
      usesJalons: m.primitives.useJalons,
      progressive: m.primitives.financingMode === "progressive",
      sequential: m.primitives.jalonsSequential,
      // Quatrième levier du catalogue, au même titre que les trois précédents : sans lui,
      // l'UI ne pouvait pas distinguer un mode à retenue de garantie d'un mode sans, et
      // décrivait J4 avec la phrase de J1.
      retentionRate: m.primitives.retentionRate,
      jalonStrategy: m.jalonStrategy,
    })),
  });
}
