import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export type KycGuardResult =
  | { ok: true; userId: string }
  | { ok: false; status: 401 | 403; error: "unauthenticated" | "kyc_not_verified" };

/**
 * US-104 — bloque l'accès aux fonctionnalités tant que le KYC n'est pas validé.
 * À appeler en tête des routes API de création de devis / mission / pointage.
 */
export async function requireVerifiedKyc(): Promise<KycGuardResult> {
  const session = await auth();
  if (!session?.user) {
    return { ok: false, status: 401, error: "unauthenticated" };
  }

  const userId = (session.user as typeof session.user & { id: string }).id;
  const user = await prisma.user.findUnique({ where: { id: userId } });

  if (!user || user.kycStatus !== "verifie") {
    return { ok: false, status: 403, error: "kyc_not_verified" };
  }

  return { ok: true, userId };
}
