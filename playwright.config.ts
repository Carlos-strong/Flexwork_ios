import { defineConfig, devices } from "@playwright/test";

// Tests NAVIGATEUR (2026-11-02) — les cas 🖐 de PLAN_TESTS_GLOBAL.md, joués dans un vrai Chrome.
//
// Base DÉDIÉE : `flexwork_browser_test`, distincte de `flexwork_dev` (travail) et de `flexwork_test`
// (vitest, qui crée et purge en masse pendant qu'un serveur lirait la même base). Préparation :
//   DATABASE_URL_TEST=postgresql://postgres@127.0.0.1:5432/flexwork_browser_test?schema=public npm run test:db:prepare
//
// Serveur de dev sur le port 3100, cache `.next-e2e` : il peut tourner à côté de `npm run dev`
// sans réécrire son `.next` (voir next.config.mjs).
//
// Navigateur : le Chrome installé (`channel: "chrome"`). Playwright ne fournit plus de Chromium
// pour macOS 12.
export const BROWSER_TEST_DATABASE_URL =
  process.env.DATABASE_URL_BROWSER_TEST ?? "postgresql://postgres@127.0.0.1:5432/flexwork_browser_test?schema=public";
const PORT = 3100;
export const BASE_URL = `http://localhost:${PORT}`;

// Les fichiers de test lisent et écrivent la même base que le serveur (jeu de données, codes OTP).
process.env.DATABASE_URL = BROWSER_TEST_DATABASE_URL;
process.env.BASE_URL = BASE_URL;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/support/global-setup.ts",
  // Un seul worker : comme pour vitest (vitest.config.ts), des parcours parallèles sur la même base
  // se marchent dessus (crons, files d'administration partagées).
  workers: 1,
  fullyParallel: false,
  // Le premier affichage d'une page en `next dev` la compile : plusieurs secondes.
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  use: {
    baseURL: BASE_URL,
    channel: "chrome",
    locale: "fr-FR",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    navigationTimeout: 60_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], channel: "chrome" }, testIgnore: /mobile\.spec\.ts/ },
    { name: "mobile", use: { ...devices["Pixel 7"], channel: "chrome", viewport: { width: 375, height: 812 } }, testMatch: /mobile\.spec\.ts/ },
  ],
  webServer: [
    {
      command: "node scripts/start-mailpit.js",
      url: "http://127.0.0.1:8025/api/v1/info",
      reuseExistingServer: true,
      timeout: 30_000,
    },
    {
      command: `npx next dev -p ${PORT}`,
      url: `${BASE_URL}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      // Les journaux du serveur noient le rapport (polices Google hors ligne, erreurs d'auth
      // attendues des tests de refus) ; `DEBUG_E2E_SERVER=1` les rétablit.
      stdout: process.env.DEBUG_E2E_SERVER ? "pipe" : "ignore",
      stderr: process.env.DEBUG_E2E_SERVER ? "pipe" : "ignore",
      env: {
        DATABASE_URL: BROWSER_TEST_DATABASE_URL,
        NEXT_DIST_DIR: ".next-e2e",
        // Pièces KYC et livrables téléversés par les tests : hors du `storage/` de développement.
        STORAGE_LOCAL_PATH: "./.next-e2e/storage",
        NEXT_PUBLIC_APP_URL: BASE_URL,
        AUTH_URL: BASE_URL,
        // Comme en recette (PLAN_TESTS_GLOBAL.md §0.1) : un paiement se confirme dans /psp-sandbox.
        ESCROW_STUB_AUTOCONFIRM: "false",
      },
    },
  ],
});
