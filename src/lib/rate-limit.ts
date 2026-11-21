// ---------------------------------------------------------------------------
// Limitation de débit partagée (2026-10-01) — utilisée par src/middleware.ts.
//
// Le compteur était une `Map` en mémoire : chaque instance Next comptait de son côté, si bien
// qu'avec N instances derrière le proxy, la limite réelle était N fois la limite affichée, et un
// redémarrage remettait tout à zéro.
//
// Le middleware de Next 14 s'exécute sur le runtime Edge : pas de socket TCP, donc pas de client
// Redis classique. On parle à Redis par son API REST (protocole Upstash), en `fetch` :
//   - Upstash (service géré) : URL + jeton fournis par la console ;
//   - Redis auto-hébergé : conteneur `serverless-redis-http` (SRH) devant Redis, même protocole
//     (voir DEPLOYMENT-PRODUCTION.md §8).
//
// Fenêtre FIXE d'une minute, clé suffixée par le numéro de fenêtre : un `INCR` + `PEXPIRE` par
// requête, une seule aller-retour (pipeline). Moins fine qu'une fenêtre glissante, mais exacte
// entre instances et sans script Lua.
//
// Panne du magasin partagé (timeout, 5xx, réseau) : on retombe sur le compteur LOCAL plutôt que
// de tout bloquer (fail-closed = site hors ligne dès que Redis tousse) ou de tout laisser passer
// (fail-open = plus aucune protection). La limite redevient approximative, jamais absente.
// ---------------------------------------------------------------------------

export const RATE_WINDOW_MS = 60_000;
const MAX_LOCAL_BUCKETS = 10_000;
const REMOTE_TIMEOUT_MS = 150;

export interface RateLimitStore {
  readonly name: string;
  /** Incrémente le compteur de `key` dans la fenêtre courante et renvoie sa nouvelle valeur. */
  hit(key: string, now: number): Promise<number>;
}

type Bucket = { count: number; resetAt: number };

export function memoryStore(): RateLimitStore {
  const buckets = new Map<string, Bucket>();
  return {
    name: "memory",
    async hit(key, now) {
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        if (buckets.size > MAX_LOCAL_BUCKETS) {
          // Purge paresseuse des fenêtres expirées pour borner la mémoire.
          for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
        }
        buckets.set(key, { count: 1, resetAt: now + RATE_WINDOW_MS });
        return 1;
      }
      bucket.count += 1;
      return bucket.count;
    },
  };
}

export function redisRestStore(opts: {
  url: string;
  token: string;
  fallback: RateLimitStore;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}): RateLimitStore {
  const doFetch = opts.fetchImpl ?? fetch;
  const endpoint = `${opts.url.replace(/\/+$/, "")}/pipeline`;
  let lastWarning = 0;
  return {
    name: "redis-rest",
    async hit(key, now) {
      const windowKey = `rl:${key}:${Math.floor(now / RATE_WINDOW_MS)}`;
      try {
        const res = await doFetch(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${opts.token}`, "Content-Type": "application/json" },
          body: JSON.stringify([
            ["INCR", windowKey],
            ["PEXPIRE", windowKey, String(RATE_WINDOW_MS)],
          ]),
          signal: AbortSignal.timeout(opts.timeoutMs ?? REMOTE_TIMEOUT_MS),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { result?: unknown; error?: string }[];
        const count = Number(body?.[0]?.result);
        if (!Number.isFinite(count)) throw new Error(body?.[0]?.error ?? "réponse illisible");
        return count;
      } catch (error) {
        // Un avertissement par minute au plus : une panne Redis ne doit pas noyer les journaux.
        if (now - lastWarning > 60_000) {
          lastWarning = now;
          console.warn(`[rate-limit] magasin partagé indisponible, compteur local en secours : ${(error as Error).message}`);
        }
        return opts.fallback.hit(key, now);
      }
    },
  };
}

/** Magasin choisi par l'environnement : Redis REST si configuré, mémoire sinon. */
export function storeFromEnv(env: Record<string, string | undefined> = process.env): RateLimitStore {
  const local = memoryStore();
  const url = env.RATE_LIMIT_REDIS_REST_URL;
  const token = env.RATE_LIMIT_REDIS_REST_TOKEN;
  if (url && token) return redisRestStore({ url, token, fallback: local });
  return local;
}

export async function isAllowed(store: RateLimitStore, key: string, limit: number, now = Date.now()): Promise<boolean> {
  return (await store.hit(key, now)) <= limit;
}
