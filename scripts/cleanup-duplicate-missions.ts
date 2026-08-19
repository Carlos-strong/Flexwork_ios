import { prisma } from "../src/lib/db";

// Nettoie les missions dupliquées (même clientId + même titre) en conservant la plus
// ancienne. Scopé au titre plomberie identifié pour éviter tout risque sur d'autres données.
async function main() {
  const groups = await prisma.mission.groupBy({
    by: ["clientId", "titre"],
    where: { titre: { contains: "plomberie", mode: "insensitive" } },
    _count: { id: true },
    having: { id: { _count: { gt: 1 } } },
  });

  for (const g of groups) {
    const rows = await prisma.mission.findMany({
      where: { clientId: g.clientId, titre: g.titre },
      orderBy: { createdAt: "asc" },
      select: { id: true, createdAt: true },
    });

    const [keep, ...duplicates] = rows;
    console.log(`Conservée : ${keep.id} (${keep.createdAt.toISOString()})`);
    for (const d of duplicates) {
      await prisma.mission.delete({ where: { id: d.id } });
      console.log(`Supprimée : ${d.id} (${d.createdAt.toISOString()})`);
    }
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
