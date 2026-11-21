import { NextResponse } from "next/server";
import { requireFrontendReader } from "@/lib/frontend-admin-guard";
import { buildFrontendDraft, getPublishedFrontendConfig, hasPendingChanges } from "@/lib/frontend-config";

export const dynamic = "force-dynamic";

/**
 * Aperçu : ce que la prochaine publication mettrait en ligne, et ce qui l'est aujourd'hui.
 *
 * Renvoie les DEUX documents plutôt que le seul brouillon. « Qu'est-ce qui va changer ? » est
 * la question que se pose réellement quelqu'un avant de publier, et on ne peut pas y répondre
 * avec un seul des deux états. Réservé aux administrateurs : c'est du contenu non publié.
 */
export async function GET() {
  const guard = await requireFrontendReader();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const [draft, published] = await Promise.all([buildFrontendDraft(), getPublishedFrontendConfig()]);
  return NextResponse.json({
    draft,
    published,
    // `true` dès que le brouillon s'écarte de ce qui est en ligne. La comparaison passe par
    // une sérialisation à clés triées : l'instantané publié revient de Postgres avec ses clés
    // réordonnées, et une comparaison naïve conclurait à une différence à tous les coups.
    hasPendingChanges: hasPendingChanges(draft, published),
  });
}
