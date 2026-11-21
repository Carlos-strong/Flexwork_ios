// Reconcilie l'état de validation KYC (user.kycStatus) de chaque compte avec l'état réel
// de ses documents KYC — "synchroniser l'état de la validation KYC du compte par rapport
// aux états des comptes créés".
//
// Règles :
//   - Compte admin (isAdmin)                → toujours "verifie" (contournement KYC, pas de
//     parcours documentaire ; l'admin KYC n'a pas besoin de se vérifier lui-même).
//   - Sinon, si un document est "rejete"    → "rejete"
//   - Sinon, si les 4 types de documents existent ET sont tous "verifie" → "verifie"
//   - Sinon (aucun / partiel / en attente)  → "en_attente"
//
// Usage : npx tsx scripts/sync-kyc-status.ts
import { PrismaClient, type KycStatus } from "@prisma/client";
import { deriveKycStatus } from "../src/lib/kyc-status";

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.user.findMany({ include: { kycDocuments: true } });
  const corrected: Array<{ email: string; role: string; from: string; to: string }> = [];
  let alreadySynced = 0;

  for (const u of users) {
    // Comptes admin : toujours "verifie" (contournement KYC, pas de parcours documentaire).
    const target: KycStatus = u.isAdmin ? "verifie" : deriveKycStatus(u.kycDocuments);

    if (u.kycStatus !== target) {
      await prisma.user.update({ where: { id: u.id }, data: { kycStatus: target } });
      corrected.push({ email: u.email, role: u.role, from: u.kycStatus, to: target });
    } else {
      alreadySynced++;
    }
  }

  console.log(`KYC synchronisé : ${corrected.length} compte(s) corrigé(s), ${alreadySynced} déjà cohérent(s).`);
  for (const c of corrected) {
    console.log(`  • ${c.email} (${c.role}) : ${c.from} → ${c.to}`);
  }
}

main()
  .catch((e) => {
    console.error("Erreur:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
