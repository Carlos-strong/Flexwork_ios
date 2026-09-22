import { NextResponse } from "next/server";
import { frontendEtag, getPublishedFrontendConfig } from "@/lib/frontend-config";

export const dynamic = "force-dynamic";

/**
 * Référentiel métier publié — domaines, spécialités, compétences.
 *
 * Extrait du même instantané que /api/frontend/config, et NON d'une requête distincte sur les
 * tables : les deux réponses décrivent ainsi forcément la même version. Deux lectures
 * indépendantes pourraient tomber de part et d'autre d'une publication et se contredire.
 *
 * L'ETag porte le suffixe `taxonomy` pour qu'un client qui met en cache les deux points
 * d'entrée ne confonde pas leurs validateurs.
 */
export async function GET(req: Request) {
  const config = await getPublishedFrontendConfig();
  const etag = frontendEtag(config.version, "taxonomy");

  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return NextResponse.json(
    { version: config.version, publishedAt: config.publishedAt, data: config.taxonomy },
    {
      headers: {
        ETag: etag,
        // Voir /api/frontend/config pour le détail : le navigateur revalide toujours (304
        // vide), les caches partagés gardent 300 s.
        "Cache-Control": "public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=600",
        "X-Frontend-Version": String(config.version),
      },
    }
  );
}
