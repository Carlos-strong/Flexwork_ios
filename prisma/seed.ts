import { PrismaClient } from "@prisma/client";
import { seedFrontendContent } from "../src/lib/frontend-seed";
import { buildFrontendDraft, publishFrontend } from "../src/lib/frontend-config";

const prisma = new PrismaClient();

// Paliers de risque de référence (modele-skillafrica-v3-Flexwork.md §7.2) — à affiner avec
// une vraie liste validée juridiquement avant activation (Phase 7, prérequis bloquant #4).
const DOMAIN_RISK_LEVELS = [
  { domain: "Peinture", riskLevel: "low" as const, insuranceRequired: false },
  { domain: "Jardinage", riskLevel: "low" as const, insuranceRequired: false },
  { domain: "Nettoyage", riskLevel: "low" as const, insuranceRequired: false },
  { domain: "Développement web", riskLevel: "low" as const, insuranceRequired: false },
  { domain: "Design UI/UX", riskLevel: "low" as const, insuranceRequired: false },
  { domain: "Plomberie", riskLevel: "medium" as const, insuranceRequired: false, amountThreshold: 200000 },
  { domain: "Menuiserie", riskLevel: "medium" as const, insuranceRequired: false, amountThreshold: 200000 },
  { domain: "Carrelage", riskLevel: "medium" as const, insuranceRequired: false, amountThreshold: 200000 },
  { domain: "Maçonnerie légère", riskLevel: "medium" as const, insuranceRequired: false, amountThreshold: 200000 },
  { domain: "Électricité", riskLevel: "high" as const, insuranceRequired: true },
  { domain: "Travail en hauteur", riskLevel: "high" as const, insuranceRequired: true },
  { domain: "Gros œuvre", riskLevel: "high" as const, insuranceRequired: true },
  { domain: "Engins de chantier", riskLevel: "high" as const, insuranceRequired: true },
];

async function main() {
  for (const entry of DOMAIN_RISK_LEVELS) {
    await prisma.domainRiskLevel.upsert({
      where: { domain_country: { domain: entry.domain, country: "BJ" } },
      create: { ...entry, country: "BJ" },
      update: { ...entry },
    });
  }
  console.log(`Seeded ${DOMAIN_RISK_LEVELS.length} domain risk levels for BJ`);

  // Contenu public éditable — reprend à l'identique ce que les composants affichaient en dur.
  const frontend = await seedFrontendContent(prisma);
  console.log(
    `Seeded frontend: ${frontend.domains} domaines, ${frontend.sections} sections ` +
      `(${frontend.items} entrées), ${frontend.menuItems} entrées de menu, ` +
      `${frontend.pages} pages, ${frontend.settings} réglages`
  );

  // Publication initiale, seulement s'il n'y en a aucune : sans elle, l'API publique n'aurait
  // rien à servir et tout le site retomberait sur le socle de repli — ce qui marcherait, mais
  // laisserait croire que l'administration n'est pas branchée.
  const existingRelease = await prisma.frontendRelease.count();
  if (existingRelease === 0) {
    const release = await publishFrontend({ adminId: null, snapshot: await buildFrontendDraft(), note: "Publication initiale (seed)" });
    console.log(`Published frontend v${release.version}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
