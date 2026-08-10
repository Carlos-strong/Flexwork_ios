import { prisma } from "@/lib/db";

const PASS_THRESHOLD = 0.7;

/**
 * US-1306 — compare le selfie et la pièce d'identité à chaque connexion/action sensible.
 * Stub : aucun SDK biométrique réel n'est branché en local ; le score est simulé
 * à partir de la présence des deux documents (remplacer par un vrai matching facial en prod).
 */
export async function runSelfieMatch(userId: string, context: string) {
  const [idDoc, selfie] = await Promise.all([
    prisma.kycDocument.findFirst({ where: { userId, type: "piece_identite_recto" } }),
    prisma.kycDocument.findFirst({ where: { userId, type: "selfie" } }),
  ]);

  const similarity = idDoc && selfie ? 0.92 : 0;
  const passed = similarity >= PASS_THRESHOLD;

  return prisma.selfieMatchLog.create({
    data: { userId, context, similarity, passed },
  });
}
