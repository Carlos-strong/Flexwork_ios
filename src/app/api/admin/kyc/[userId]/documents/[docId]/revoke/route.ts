import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";
import { recordVerificationHistory } from "@/lib/verification-history";
import { notifyUser } from "@/lib/notify";
import { deriveKycStatus } from "@/lib/kyc-status";

const schema = z.object({ justification: z.string().min(1) });

// Révoque la validation d'un document KYC (décision potentiellement erronée) : le document
// repasse en "en_attente" et l'état global du compte (user.kycStatus) est resynchronisé via
// deriveKycStatus — même règle que la décision par document et le script de réconciliation.
// Toute révocation est journalisée (AdminAuditLog) et tracée dans l'historique chaîné.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string; docId: string }> }
) {
  const guard = await requireAdminRole("kyc");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { userId, docId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const doc = await prisma.kycDocument.findFirst({ where: { id: docId, userId } });
  if (!doc) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!doc.reviewedById) {
    return NextResponse.json({ error: "not_reviewed" }, { status: 400 });
  }

  const updated = await prisma.kycDocument.update({
    where: { id: docId },
    data: { status: "en_attente", reviewedById: null, reviewedAt: null, rejectionReason: null },
  });

  // Resynchronisation de l'état global du compte depuis l'état réel de ses documents.
  const allDocs = await prisma.kycDocument.findMany({ where: { userId } });
  const derived = deriveKycStatus(allDocs);
  const user = await prisma.user.update({ where: { id: userId }, data: { kycStatus: derived } });

  await logAdminAction({
    adminId: guard.user.id,
    action: "kyc_decision_revoked",
    targetType: "KycDocument",
    targetId: docId,
    justification: parsed.data.justification,
  });
  await recordVerificationHistory({
    subjectType: "kyc",
    subjectId: userId,
    event: `document:${doc.type}:revoked`,
  });

  await notifyUser({
    userId,
    type: "kyc_rejete",
    message: `La validation de votre document (${doc.type}) a été révoquée. Votre dossier repasse en attente de revue.`,
    email: {
      subject: "Mise à jour de votre dossier KYC",
      text: `La validation de votre document (${doc.type}) a été révoquée par notre équipe. Votre dossier repasse en attente de revue.`,
      html: `<p>La validation de votre document (<strong>${doc.type}</strong>) a été révoquée par notre équipe.</p><p>Votre dossier repasse en <strong>attente</strong> de revue.</p>`,
    },
  });

  // Accusé à l'admin qui vient de révoquer (non bloquant).
  void notifyUser({
    userId: guard.user.id,
    type: "kyc_decision_admin",
    message: `Validation du document ${doc.type} de ${user.email} révoquée — le dossier repasse en attente.`,
  }).catch(() => {});

  return NextResponse.json({ document: updated, kycStatus: user.kycStatus });
}
