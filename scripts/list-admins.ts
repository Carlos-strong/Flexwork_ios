import { PrismaClient } from "@prisma/client";

// Liste des comptes portant un pouvoir d'administration — outil de dépannage local.
// Auth 100 % OTP : il n'existe AUCUN mot de passe à afficher, seulement l'identifiant
// (e-mail ou téléphone) sur lequel demander un code. Le code se lit dans Mailpit en dev.
async function main() {
  const prisma = new PrismaClient();
  const users = await prisma.user.findMany({
    where: { OR: [{ isAdmin: true }, { adminRole: { not: null } }] },
    select: { id: true, email: true, tel: true, role: true, status: true, adminRole: true, isAdmin: true, passwordHash: true },
    orderBy: [{ adminRole: "asc" }, { email: "asc" }],
  });

  for (const u of users) {
    console.log(
      [
        (u.adminRole ?? "(aucun rôle)").padEnd(12),
        u.email.padEnd(30),
        u.tel.padEnd(16),
        `motDePasse=${u.passwordHash ? "oui" : "aucun"}`,
        `isAdmin=${u.isAdmin}`,
        `statut=${u.status}`,
        u.id,
      ].join(" | "),
    );
  }

  const covered = new Set(users.map((u) => u.adminRole));
  const missing = (["kyc", "moderation", "mediation", "superviseur", "frontend"] as const).filter((r) => !covered.has(r));

  console.log(`\n${users.length} compte(s) d'administration.`);
  if (missing.length > 0) {
    console.log(`Rôles SANS compte, donc intestables : ${missing.join(", ")}.`);
  }
  await prisma.$disconnect();
}

main();
