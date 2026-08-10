import { prisma } from "@/lib/db";
import { computeChainedHash } from "@/lib/hash-chain";
import type { VerificationSubjectType } from "@prisma/client";

// US-804 (Phase 8) — historique global chaîné par hash, couvre KYC (Phase 2) et
// déclarations (Phase 3) dans un seul flux consultable en cas de recours. Chaîné par
// sujet (subjectType + subjectId), pas globalement — chaque profil/utilisateur a sa
// propre chaîne indépendante.
export async function recordVerificationHistory(params: {
  subjectType: VerificationSubjectType;
  subjectId: string;
  event: string;
}) {
  const last = await prisma.verificationHistoryEntry.findFirst({
    where: { subjectType: params.subjectType, subjectId: params.subjectId },
    orderBy: { createdAt: "desc" },
  });

  const payload = { subjectType: params.subjectType, subjectId: params.subjectId, event: params.event };
  const currentHash = computeChainedHash(last?.currentHash ?? null, payload);

  return prisma.verificationHistoryEntry.create({
    data: {
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      event: params.event,
      previousHash: last?.currentHash ?? null,
      currentHash,
    },
  });
}
