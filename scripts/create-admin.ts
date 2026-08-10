import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Vérifier si un admin existe déjà
  const existing = await prisma.user.findFirst({ where: { isAdmin: true } });
  if (existing) {
    console.log("⚠️  Un admin existe déjà :");
    console.log(`   ID    : ${existing.id}`);
    console.log(`   Email : ${existing.email}`);
    console.log(`   Tél   : ${existing.tel}`);
    console.log(`   Rôle  : ${existing.adminRole ?? "aucun rôle admin"}`);
    await prisma.$disconnect();
    return;
  }

  const admin = await prisma.user.create({
    data: {
      email: "admin@flexwork.bj",
      tel: "+22900000000",
      role: "client",
      firstname: "Admin",
      lastname: "FlexWork",
      country: "BJ",
      city: "Cotonou",
      isAdmin: true,
      adminRole: "superviseur",
      emailVerified: new Date(),
    },
  });

  console.log("✅ Admin créé avec succès :");
  console.log(`   ID    : ${admin.id}`);
  console.log(`   Email : ${admin.email}`);
  console.log(`   Tél   : ${admin.tel}`);
  console.log(`   Rôle  : ${admin.adminRole}`);
  console.log("");
  console.log("🔐 Connexion : va sur /signin, entre l'email ci-dessus,");
  console.log("   reçois le code OTP par email, puis connecte-toi.");

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error("❌ Erreur :", e);
  await prisma.$disconnect();
  process.exit(1);
});
