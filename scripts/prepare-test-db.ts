// Prépare la base DÉDIÉE aux tests (2026-10-01) : `npm run test:db:prepare`.
//
// Les tests tournaient sur `flexwork_dev`, la base de travail. Un nettoyage défaillant y a vidé
// missions, contrats et messages. Ils ont désormais leur propre base, que ce script crée au
// besoin, met au niveau des migrations et remplit du strict nécessaire :
//   - le seed standard (contenu public, catalogue catégories → métiers → services) ;
//   - les comptes et missions de démonstration de la messagerie (test-msg-*).
//
// Idempotent : on peut le relancer après chaque nouvelle migration.

import { execSync } from "node:child_process";
import { TEST_DATABASE_URL, assertTestDatabaseUrl } from "../src/lib/test-database";

assertTestDatabaseUrl(TEST_DATABASE_URL);
const env = { ...process.env, DATABASE_URL: TEST_DATABASE_URL };
const run = (label: string, cmd: string) => {
  console.log(`\n▶ ${label}`);
  execSync(cmd, { stdio: "inherit", env });
};

console.log(`Base de test : ${TEST_DATABASE_URL.replace(/\/\/[^@]*@/, "//***@")}`);
// `migrate deploy` crée la base si elle n'existe pas encore, puis applique les migrations.
run("Migrations", "npx prisma migrate deploy");
run("Seed standard (contenu public, catalogue)", "npx tsx prisma/seed.ts");
run("Données de démonstration de la messagerie", "npx tsx scripts/seed-messaging-test.ts");
console.log("\n✅ Base de test prête. Lancez `npm test`.");
