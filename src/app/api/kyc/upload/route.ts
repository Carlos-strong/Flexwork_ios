import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { saveKycFile } from "@/lib/storage";
import { hashIdNumber, findAccountConflicts } from "@/lib/dedupe";
import { recordVerificationHistory } from "@/lib/verification-history";

const VALID_TYPES = ["piece_identite_recto", "piece_identite_verso", "selfie", "selfie_avec_piece"] as const;

// US-201 (Phase 2) : parcours KYC en 4 étapes — recto, verso, selfie, selfie+pièce.
// Formats/tailles à valider côté client (PDF/JPG/PNG, 5 Mo max) — le contrôle serveur du
// Content-Length se fait au niveau de la plateforme de déploiement, pas dupliqué ici.
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  // US-202 : une fois le KYC validé par l'admin, plus aucune resoumission — évite qu'un
  // compte déjà vérifié réinjecte de nouveaux documents (dérive du statut, contournement
  // implicite d'une éventuelle suspicion levée par l'admin lors de la décision initiale).
  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true } });
  if (existing?.kycStatus === "verifie") {
    return NextResponse.json({ error: "kyc_already_verified" }, { status: 409 });
  }

  const formData = await req.formData();
  const type = formData.get("type");
  const file = formData.get("file");
  const idNumber = formData.get("idNumber"); // requis seulement pour le recto

  if (!VALID_TYPES.includes(type as (typeof VALID_TYPES)[number]) || !(file instanceof File)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  let idNumberHash: string | undefined;
  if (type === "piece_identite_recto") {
    if (typeof idNumber !== "string" || idNumber.length < 3) {
      return NextResponse.json({ error: "id_number_required" }, { status: 400 });
    }
    idNumberHash = hashIdNumber(idNumber);

    const conflict = await findAccountConflicts({ idNumberHash, excludeUserId: userId });
    if (conflict.conflict) {
      return NextResponse.json(
        { error: "duplicate_account_suspected", reason: conflict.reason },
        { status: 409 }
      );
    }
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filePath = await saveKycFile({ userId, fileName: file.name, buffer });

  const doc = await prisma.kycDocument.create({
    data: {
      userId,
      type: type as (typeof VALID_TYPES)[number],
      filePath,
      idNumberHash,
    },
  });

  await recordVerificationHistory({ subjectType: "kyc", subjectId: userId, event: `document_deposed:${doc.type}` });

  // Synchronisation KYC : un compte précédemment rejeté qui resoumet des documents repasse
  // en "en_attente" (nouvelle revue en cours). Sinon user.kycStatus resterait "rejete" alors
  // que les nouveaux documents sont déjà "en_attente" — état incohérent côté /kyc et file
  // admin (scripts/sync-kyc-status.ts applique la même règle aux comptes existants).
  if (existing?.kycStatus === "rejete") {
    await prisma.user.update({
      where: { id: userId },
      data: { kycStatus: "en_attente" },
    });
    await recordVerificationHistory({ subjectType: "kyc", subjectId: userId, event: "resubmission:en_attente" });
  }

  return NextResponse.json({ id: doc.id, type: doc.type, status: doc.status });
}
