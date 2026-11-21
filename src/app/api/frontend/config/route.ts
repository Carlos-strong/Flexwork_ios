import { NextResponse } from "next/server";
import { frontendEtag, getPublishedFrontendConfig } from "@/lib/frontend-config";

// Sert TOUJOURS le dernier instantané publié, jamais les tables de travail : une section en
// cours d'écriture ne peut pas fuiter sur le site public.
export const dynamic = "force-dynamic";

/**
 * Configuration publique du frontend.
 *
 * Gère `If-None-Match` : un client qui détient déjà la version servie reçoit un 304 vide.
 * L'économie n'est pas théorique — ce document transporte la taxonomie complète, et la page
 * d'accueil le redemande à chaque navigation.
 */
export async function GET(req: Request) {
  const config = await getPublishedFrontendConfig();
  const etag = frontendEtag(config.version);

  if (req.headers.get("if-none-match") === etag) {
    return new Response(null, { status: 304, headers: { ETag: etag } });
  }

  return NextResponse.json(config, {
    headers: {
      ETag: etag,
      // `max-age=0, must-revalidate` s'adresse au NAVIGATEUR : il revalide à chaque fois,
      // ce qui ne coûte presque rien puisque la revalidation se solde par un 304 vide. Sans
      // ces deux directives, un navigateur applique une fraîcheur heuristique et sert un
      // corps périmé sans rien demander — constaté le 2026-09-21, une publication restait
      // invisible dans l'onglet alors que l'origine servait déjà la version suivante, ce qui
      // vidait de son sens tout le travail sur l'ETag.
      //
      // `s-maxage` s'adresse aux caches PARTAGÉS (CDN), qui peuvent, eux, garder la réponse
      // sans revalider : une publication y devient visible au bout de 300 s au plus. Le jour
      // où un CDN est mis en place, c'est ici qu'il faudra purger la ressource au moment de
      // la publication plutôt que d'attendre cette expiration.
      "Cache-Control": "public, max-age=0, must-revalidate, s-maxage=300, stale-while-revalidate=600",
      "X-Frontend-Version": String(config.version),
    },
  });
}
