import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();

async function main() {
  const otps = await p.otpCode.findMany({
    where: { identifier: "testclient@flexwork.test" },
    orderBy: { createdAt: "desc" },
    take: 1,
  });
  console.log(JSON.stringify(otps, null, 2));

  // Also check if user exists
  const user = await p.user.findUnique({
    where: { email: "testclient@flexwork.test" },
    select: { id: true, email: true, role: true, firstname: true, lastname: true },
  });
  console.log("USER:", JSON.stringify(user, null, 2));

  await p.$disconnect();
}

main();
