// Base de données des TESTS (2026-10-01) — distincte de la base de travail `flexwork_dev`.
//
// Surcharge possible par `DATABASE_URL_TEST`. Par défaut, la même instance Postgres que la base
// de développement, sous le nom `flexwork_test`.
export const TEST_DATABASE_URL =
  process.env.DATABASE_URL_TEST ?? "postgresql://postgres@127.0.0.1:5432/flexwork_test?schema=public";

/**
 * Refuse toute base dont le nom ne se termine pas par `_test`. Les tests créent et suppriment des
 * données en masse : pointés par erreur sur une base de travail, ils la détruiraient — c'est ce
 * qui est arrivé à `flexwork_dev` avant la séparation.
 */
export function assertTestDatabaseUrl(url: string | undefined): void {
  const nom = url ? new URL(url).pathname.replace(/^\//, "") : "";
  if (!nom.endsWith("_test")) {
    throw new Error(
      `[tests] Base refusée : « ${nom || "(aucune)"} ». Les tests ne s'exécutent que sur une base dont le nom se termine par « _test » (voir DATABASE_URL_TEST, puis \`npm run test:db:prepare\`).`
    );
  }
}
