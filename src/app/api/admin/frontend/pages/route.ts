import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireFrontendReader } from "@/lib/frontend-admin-guard";
import { CONFIG_DRIVEN_PAGES, PUBLIC_ROUTES } from "@/lib/frontend-defaults";

export const dynamic = "force-dynamic";

/**
 * Pages éditoriales, rapprochées des routes réellement servies par src/app.
 *
 * Trois états possibles, et l'écran doit pouvoir les distinguer :
 *   · `synchronisee` — la route existe et son entrée aussi ;
 *   · `absente`      — la route existe mais n'a pas encore d'entrée éditable ;
 *   · `orpheline`    — l'entrée existe mais la route a disparu du code. Son référencement
 *                      est édité pour une page que plus personne ne peut ouvrir.
 *
 * Et, transversalement, `piloted` : la page compose-t-elle vraiment ses métadonnées depuis la
 * configuration ? Trois routes publiques sont des composants client et ne le peuvent pas ; le
 * dire évite de laisser éditer un référencement qui ne partirait nulle part.
 *
 * Aucune de ces situations n'est corrigée en silence : l'administrateur voit l'écart et
 * tranche. Créer automatiquement les entrées manquantes masquerait le cas orphelin, qui est
 * le seul des trois à signaler un vrai problème.
 */
export async function GET() {
  const guard = await requireFrontendReader();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const stored = await prisma.frontendPage.findMany({ orderBy: { path: "asc" } });
  const knownPaths = new Set(PUBLIC_ROUTES.map((r) => r.path));
  const storedPaths = new Set(stored.map((p) => p.path));

  return NextResponse.json({
    pages: stored.map((p) => ({
      ...p,
      state: knownPaths.has(p.path) ? "synchronisee" : "orpheline",
      piloted: CONFIG_DRIVEN_PAGES.includes(p.path),
    })),
    missing: PUBLIC_ROUTES.filter((r) => !storedPaths.has(r.path)),
  });
}
