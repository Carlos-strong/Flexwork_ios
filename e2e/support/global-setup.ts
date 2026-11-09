import { assertTestDatabaseUrl } from "../../src/lib/test-database";

// Refuse de jouer les parcours ailleurs que sur une base `*_test` : ils créent des comptes, des
// missions et des paiements, et le serveur de dev lancé par playwright.config.ts écrit dans la
// même base.
export default async function globalSetup() {
  assertTestDatabaseUrl(process.env.DATABASE_URL);
  const { prisma } = await import("./db");
  // Réglage de recette (PLAN_TESTS_GLOBAL.md §0.1) : PSP virtuelle ouverte pour la zone BJ.
  await prisma.featureFlag.upsert({
    where: { key_zone: { key: "psp_montage_valide", zone: "BJ" } },
    update: { enabled: true },
    create: { key: "psp_montage_valide", zone: "BJ", enabled: true },
  });
  await prisma.$disconnect();
}
