import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { displayFileName } from "@/lib/storage";

// Historique des validations KYC pour l'Admin KYC — chaque document examiné (validé ou
// rejeté, via décision de dossier ou par document) est listé avec le réviseur et la date.
// C'est la base de la révocation d'une validation potentiellement erronée
// (POST /api/admin/kyc/[userId]/documents/[docId]/revoke).
export async function GET() {
  const guard = await requireAdminRole("kyc");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const docs = await prisma.kycDocument.findMany({
    where: { reviewedById: { not: null } },
    include: {
      user: { select: { id: true, email: true, tel: true, firstname: true, lastname: true, kycStatus: true } },
      reviewedBy: { select: { email: true } },
    },
    orderBy: { reviewedAt: "desc" },
    take: 100,
  });

  return NextResponse.json({
    history: docs.map((d) => ({
      docId: d.id,
      type: d.type,
      fileName: displayFileName(d.filePath),
      status: d.status,
      rejectionReason: d.rejectionReason,
      reviewedBy: d.reviewedBy?.email ?? null,
      reviewedAt: d.reviewedAt,
      user: {
        id: d.user.id,
        email: d.user.email,
        tel: d.user.tel,
        firstname: d.user.firstname,
        lastname: d.user.lastname,
        kycStatus: d.user.kycStatus,
      },
    })),
  });
}
