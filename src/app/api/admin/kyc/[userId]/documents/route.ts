import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { displayFileName, getStoredFileSize, signKycDocToken } from "@/lib/storage";

// Tous les documents KYC d'un utilisateur avec une URL signée (5 min) pour visualisation —
// admin KYC uniquement. Les fichiers sont privés (jamais servis statiquement) ; seule cette
// URL signée (/api/kyc/file/[token], qui vérifie owner/admin) permet de les afficher dans
// le tableau de validation.
export async function GET(_req: Request, { params }: { params: Promise<{ userId: string }> }) {
  const guard = await requireAdminRole("kyc");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { userId } = await params;
  const docs = await prisma.kycDocument.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  const documents = await Promise.all(
    docs.map(async (doc) => ({
      id: doc.id,
      type: doc.type,
      fileName: displayFileName(doc.filePath),
      size: await getStoredFileSize(doc.filePath),
      status: doc.status,
      rejectionReason: doc.rejectionReason,
      reviewedBy: doc.reviewedById,
      reviewedAt: doc.reviewedAt,
      createdAt: doc.createdAt,
      url: `/api/kyc/file/${signKycDocToken(doc.id)}`,
    }))
  );

  return NextResponse.json({ documents });
}
