import { prisma } from "@/lib/db";

// Compte de versement VÉRIFIÉ pour un prestataire de test (2026-11-02). Depuis la politique KYC
// (src/lib/kyc-policy.ts), aucun versement ne part vers un compte non contrôlé : un test qui
// attend une libération doit donner au prestataire un compte vérifié, comme en production.
// Supprimé avec l'utilisateur (onDelete: Cascade).
export async function givePayoutAccount(userId: string) {
  await prisma.payoutAccount.upsert({
    where: { userId },
    update: { status: "verifie" },
    create: { userId, operator: "mtn", number: "+22990000000", holder: "Titulaire Test", status: "verifie" },
  });
}
