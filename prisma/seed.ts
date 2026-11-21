import { PrismaClient } from "@prisma/client";
import { seedFrontendContent } from "../src/lib/frontend-seed";
import { buildFrontendDraft, publishFrontend } from "../src/lib/frontend-config";
import { seedCatalog } from "./seed-catalog";

const prisma = new PrismaClient();

// Le palier de risque N'EST PLUS semé ici (2026-09-24).
//
// Il vivait dans `DomainRiskLevel`, une table indexée sur un libellé LIBRE : ses lignes ne
// correspondaient à presque aucun des 220 métiers du catalogue, si bien que le palier
// « élevé » n'était jamais atteint et que l'obligation d'assurance ne se déclenchait jamais.
// Il est porté depuis par `Metier.riskLevel`, saisi par l'administrateur dans la taxonomie.
//
// La table est conservée pour ne détruire aucune donnée, mais son commentaire de schéma
// affirme que « plus rien ne la lit ni ne l'écrit » — ce que ce seed démentait en y écrivant
// 13 lignes à chaque passage, et en annonçant des paliers que le produit n'appliquait plus.

async function main() {
  // Contenu public éditable — reprend à l'identique ce que les composants affichaient en dur.
  const frontend = await seedFrontendContent(prisma);
  console.log(
    `Seeded frontend: ${frontend.sections} sections ` +
      `(${frontend.items} entrées), ${frontend.menuItems} entrées de menu, ` +
      `${frontend.pages} pages, ${frontend.settings} réglages`
  );

  // Taxonomie Catégorie → Métier → Service (catalogue de flexwork_job), seulement si elle est
  // vide : seedCatalog efface avant de recréer, il ne doit pas écraser un catalogue édité.
  if ((await prisma.categorie.count()) === 0) await seedCatalog(prisma);

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
