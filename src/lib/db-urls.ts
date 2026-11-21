// URL de connexion DIRECTE à Postgres (2026-10-01), pour ce qui ne passe pas par PgBouncer en
// mode transaction :
//   - `LISTEN` (temps réel, src/lib/realtime/hub.ts) : un abonnement vit sur UNE session, que le
//     mode transaction rend à la réserve après chaque requête ;
//   - pg-boss (src/worker/index.ts) : verrous consultatifs et requêtes de maintenance de session ;
//   - les migrations Prisma.
//
// DIRECT_DATABASE_URL quand l'application passe par PgBouncer ; sinon DATABASE_URL suffit. Les
// paramètres propres à Prisma (`schema`, `pgbouncer`, `connection_limit`, `pool_timeout`) sont
// retirés : le pilote `pg` ne les connaît pas.
const PRISMA_ONLY_PARAMS = ["schema", "pgbouncer", "connection_limit", "pool_timeout", "statement_cache_size"];

export function directDatabaseUrl(override?: string): string {
  const raw = override ?? process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!raw) throw new Error("DATABASE_URL manquant");
  const url = new URL(raw);
  for (const p of PRISMA_ONLY_PARAMS) url.searchParams.delete(p);
  return url.toString();
}

/** Vrai si DATABASE_URL vise PgBouncer sans URL directe déclarée — configuration à corriger. */
export function pgbouncerWithoutDirectUrl(): boolean {
  const raw = process.env.DATABASE_URL ?? "";
  return /[?&]pgbouncer=true/.test(raw) && !process.env.DIRECT_DATABASE_URL;
}
