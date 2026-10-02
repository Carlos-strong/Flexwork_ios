import { defineConfig } from "vitest/config";
import path from "path";
import { TEST_DATABASE_URL } from "./src/lib/test-database";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Base DÉDIÉE aux tests (2026-10-01), jamais `flexwork_dev` : préparée par
    // `npm run test:db:prepare`, et vérifiée avant chaque fichier (src/test/assert-test-db.ts).
    env: { DATABASE_URL: TEST_DATABASE_URL },
    setupFiles: ["./src/test/assert-test-db.ts"],
    // Les tests e2e frappent tous la même base Postgres ; en parallèle, la contention
    // dépasse régulièrement le timeout par défaut de 5 s et fait échouer des tests qui
    // passent en 2 s isolément (constaté 2026-09-16).
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Fichiers exécutés UN PAR UN (2026-10-01). Deux raisons, toutes deux constatées :
    //   1. Sous charge parallèle, des `beforeAll` dépassaient leur délai ; leur `afterAll` nettoyait
    //      alors avec des identifiants `undefined` — ce qui a vidé missions, contrats et messages de
    //      la base de développement (le garde-fou de src/lib/db.ts l'empêche désormais).
    //   2. Des balayages GLOBAUX (remboursement des reliquats, acceptation tacite…) lancés par un
    //      fichier traitaient les données d'un autre en cours d'exécution — `admin-finance`
    //      échouait par intermittence quand `workflow-crons` remboursait son reliquat.
    // Coût mesuré : ~1 min 40 pour toute la suite, en échange d'un résultat reproductible.
    fileParallelism: false,
  },
});
