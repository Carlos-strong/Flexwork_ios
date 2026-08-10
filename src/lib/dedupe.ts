import crypto from "crypto";
import { prisma } from "@/lib/db";

export function hashIdNumber(idNumber: string): string {
  return crypto.createHash("sha256").update(idNumber.trim().toUpperCase()).digest("hex");
}

/**
 * US-1308 — empêche la création de comptes multiples en croisant empreinte device,
 * hash de la pièce d'identité et numéro de téléphone.
 * À appeler avant de créer un compte (device + tel) et avant de valider une pièce (hash).
 */
export async function findAccountConflicts(params: {
  deviceFingerprint?: string | null;
  tel?: string | null;
  idNumberHash?: string | null;
  excludeUserId?: string;
}): Promise<{ conflict: boolean; reason?: "device" | "tel" | "id_document" }> {
  if (params.tel) {
    const byTel = await prisma.user.findFirst({
      where: { tel: params.tel, id: { not: params.excludeUserId } },
    });
    if (byTel) return { conflict: true, reason: "tel" };
  }

  if (params.deviceFingerprint) {
    const byDevice = await prisma.user.findFirst({
      where: {
        deviceFingerprint: params.deviceFingerprint,
        id: { not: params.excludeUserId },
      },
    });
    if (byDevice) return { conflict: true, reason: "device" };
  }

  if (params.idNumberHash) {
    const byDocument = await prisma.kycDocument.findFirst({
      where: {
        idNumberHash: params.idNumberHash,
        userId: { not: params.excludeUserId },
      },
    });
    if (byDocument) return { conflict: true, reason: "id_document" };
  }

  return { conflict: false };
}
