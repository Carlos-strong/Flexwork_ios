import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "node",
    // Les tests e2e frappent tous la même base Postgres ; en parallèle, la contention
    // dépasse régulièrement le timeout par défaut de 5 s et fait échouer des tests qui
    // passent en 2 s isolément (constaté 2026-09-16).
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
