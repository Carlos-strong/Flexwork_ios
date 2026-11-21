import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { KYC_DOC_TYPES } from "@/lib/kyc-status";

// Statut KYC courant de l'utilisateur connecté — utilisé par /kyc pour savoir s'il faut
// afficher le formulaire ou un état "déjà vérifié" (US-202 : plus de resoumission possible
// une fois validé, voir POST /api/kyc/upload qui refuse déjà en 409).
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } });
  if (!user) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // `documentsSubmitted` (2026-11-10) : distingue « justificatifs en cours d'examen » de
  // « justificatifs pas encore envoyés » pour les bandeaux d'étape bloquée (KycRequiredBanner).
  const documentsSubmitted =
    user.kycStatus !== "verifie" &&
    (await prisma.kycDocument.count({ where: { userId, type: { in: [...KYC_DOC_TYPES] } } })) > 0;

  return NextResponse.json({ kycStatus: user.kycStatus, documentsSubmitted });
}
