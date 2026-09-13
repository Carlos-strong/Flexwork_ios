import { prisma } from "../src/lib/db";

// Inspection temporaire : liste toutes les missions avec les acteurs liés pour décider du
// nettoyage. À SUPPRIMER après usage.
async function main() {
  const missions = await prisma.mission.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      titre: true,
      status: true,
      createdAt: true,
      updatedAt: true,
      budget: true,
      client: { select: { email: true, firstname: true, lastname: true } },
      proposals: { select: { provider: { select: { email: true } }, status: true } },
      contract: { select: { id: true, clientId: true, providerId: true, clientSignedAt: true, providerSignedAt: true } },
    },
  });

  const clients = new Map<string, { email: string; count: number }>();
  console.log(`Total missions : ${missions.length}\n`);
  for (const m of missions) {
    const clientKey = m.client?.email ?? "(inconnu)";
    clients.set(clientKey, { email: clientKey, count: (clients.get(clientKey)?.count ?? 0) + 1 });
    const providers = [...new Set(m.proposals.map((p) => p.provider.email))];
    const c = m.contract;
    console.log(
      `- ${m.id} | "${m.titre}" | ${m.status} | budget=${m.budget} | créée=${m.createdAt.toISOString()} | maj=${m.updatedAt.toISOString()}`
    );
    console.log(`    client=${clientKey} | prestataires=[${providers.join(", ")}] | contrat=${c?.id ?? "—"} (clientSigned=${!!c?.clientSignedAt}, providerSigned=${!!c?.providerSignedAt})`);
  }

  console.log(`\nMissions par client :`);
  for (const [email, { count }] of clients) {
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, adminRole: true, createdAt: true } });
    console.log(`  ${email} → ${count} mission(s)${user ? ` | user=${user.id} | adminRole=${user.adminRole ?? "—"} | créé=${user.createdAt.toISOString()}` : ""}`);
  }
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
