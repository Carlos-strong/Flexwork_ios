// Chargé avant chaque fichier de test (vitest.config.ts, `setupFiles`) : aucun test ne démarre
// si la base visée n'est pas une base de test.
import { assertTestDatabaseUrl } from "@/lib/test-database";

assertTestDatabaseUrl(process.env.DATABASE_URL);
