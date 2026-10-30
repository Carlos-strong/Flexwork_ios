import { NextResponse, type NextRequest } from "next/server";
import { isAllowed, storeFromEnv } from "@/lib/rate-limit";

// Prérequis production complets (proxy, multi-instance, limites) : voir DEPLOYMENT-PRODUCTION.md

// Couche C1 — périmètre (« Modèle de sécurité Flexwork ») : filtrage avant exécution.
// C'était la seule couche entièrement absente du projet (aucun middleware.ts avant ce
// fichier) — sans elle, une faille d'autorisation (F-01/F-02) cesse d'être ponctuelle et
// devient une extraction massive par simple énumération d'identifiants.
//
// Compteur PARTAGÉ entre instances quand RATE_LIMIT_REDIS_REST_URL est configuré (Redis via son
// API REST, compatible runtime Edge — voir src/lib/rate-limit.ts) ; en mémoire sinon, ce qui ne
// vaut que pour une instance unique.
//
// ⚠️ L'IP est DÉCLARÉE (x-forwarded-for) tant qu'un reverse-proxy de confiance n'écrase pas
// ce header en amont — même mise en garde que src/lib/otp.ts::getClientIp. Un appelant
// direct peut faire varier son IP déclarée à chaque requête : cette limite protège
// réellement derrière un proxy configuré, pas dans une topologie sans proxy.

export const config = {
  // Exclut les fichiers statiques : le plafond doit protéger l'API et les pages, pas
  // compter les requêtes d'images, polices et chunks JS.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

// 60 était trop bas : une session active (chargement de page + polling 30s de la cloche et
// du sidebar) dépassait 60 req/min et bloquait l'utilisateur avec un "Too Many Requests"
// arbitraire. 240/min laisse une marge confortable pour un usage réel tout en bornant un
// acteur unique bien au-delà d'un comportement humain.
const GLOBAL_LIMIT = 240; // plafond global par IP (requêtes API + pages)
// 20 se faisait atteindre par un simple chargement de page + le polling 30s (voir commentaire
// plus bas). 60/min (≈1/s) borne toujours fermement l'énumération tout en évitant les faux
// positifs sur un usage normal des routes sensibles.
const SENSITIVE_LIMIT = 60; // plafond bas sur les routes sensibles à l'énumération

// Magasin créé une fois par instance (isolat Edge) : le compteur local de secours doit survivre
// d'une requête à l'autre.
// Variables lues une à une, explicitement : c'est la forme que le runtime Edge garantit.
const store = storeFromEnv({
  RATE_LIMIT_REDIS_REST_URL: process.env.RATE_LIMIT_REDIS_REST_URL,
  RATE_LIMIT_REDIS_REST_TOKEN: process.env.RATE_LIMIT_REDIS_REST_TOKEN,
});

export async function middleware(req: NextRequest) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";
  const pathname = req.nextUrl.pathname;

  const res = NextResponse.next();
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // ⚠️ En dev/test, PAS de rate-limit — c'est la cause du bug "Too Many Requests" : sans
  // reverse-proxy de confiance qui écrase x-forwarded-for, tout le trafic local tombe dans
  // le bucket "unknown" (un SEUL seau partagé) qui se remplit en quelques minutes de
  // navigation + polling (cloche 30s, badges sidebar 30s) et bloque l'utilisateur
  // arbitrairement. Le rate-limit ne protège réellement que derrière un proxy (voir
  // l'avertissement sur l'IP déclarée en tête de fichier) — on ne l'applique donc qu'en
  // production, où il garde son rôle anti-énumération.
  if (process.env.NODE_ENV !== "production") return res;

  // Plafond distinct et plus bas sur les points sensibles à l'énumération — c'est
  // exactement là que F-01 (proposals) et F-02 (signature) se transforment en aspiration.
  // ⚠️ Deux seaux SÉPARÉS par IP : une même clé pour les deux limites verrouillerait un
  // utilisateur hors des routes sensibles après seulement SENSITIVE_LIMIT requêtes
  // ordinaires dans la minute (le compteur unique s'incrémente partout, mais la limite
  // comparée change selon le chemin).
  const isSensitive =
    pathname.startsWith("/api/signature") ||
    (pathname.startsWith("/api/missions/") && pathname.includes("/proposals"));
  // Seul le chemin API compte comme sensible — pas la PAGE /missions/[id]/proposals.
  const key = isSensitive ? `ip:${ip}:sensitive` : `ip:${ip}:global`;
  if (!(await isAllowed(store, key, isSensitive ? SENSITIVE_LIMIT : GLOBAL_LIMIT))) {
    return new NextResponse("Too Many Requests", { status: 429 });
  }

  return res;
}
