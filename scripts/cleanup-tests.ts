import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  // Supprimer TOUS les utilisateurs de test et leurs données liées
  const testUsers = await p.user.findMany({
    where: { email: { contains: "flexwork.test" } },
    select: { id: true, email: true },
  });
  console.log(`Found ${testUsers.length} test users`);
  for (const u of testUsers) console.log(`  - ${u.email} (${u.id})`);

  // Supprimer les missions de test
  await p.message.deleteMany({ where: { missionId: { startsWith: "test-msg-" } } });
  await p.missionProposal.deleteMany({ where: { missionId: { startsWith: "test-msg-" } } });
  await p.mission.deleteMany({ where: { id: { startsWith: "test-msg-" } } });

  // Supprimer les OTP
  await p.otpCode.deleteMany({ where: { user: { email: { contains: "flexwork.test" } } } });

  // Supprimer les utilisateurs
  await p.user.deleteMany({ where: { email: { contains: "flexwork.test" } } });

  console.log("Cleaned up all test data");
  await p.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
