import path from "path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { saveKycFile } from "@/lib/storage";
import { recordVerificationHistory } from "@/lib/verification-history";

// Justificatif de domicile du dossier financier (2026-09-23).
//
// Passé par une route dédiée plutôt que par `/api/kyc/upload` : celle-ci refuse toute
// resoumission dès que l'identité est vérifiée (`kyc_already_verified`), or c'est justement
// l'état d'un prestataire au moment où il renseigne son compte de versement. La garde du
// dossier d'identité reste donc intacte.
//
// Le fichier part dans le MÊME bucket privé que les pièces d'identité : même chiffrement au
// repos, même URL signée à 5 minutes, même écran d'instruction pour l'Admin KYC. Un bucket
// de plus n'aurait ajouté qu'un chemin à sécuriser.

const MAX_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = ["image/jpeg", "image/png", "image/webp", "application/pdf"];

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return NextResponse.json(
      { error: "unsupported_file_type", message: "Formats acceptés : JPG, PNG, WEBP ou PDF." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "file_too_large", message: "Fichier trop volumineux — 5 Mo maximum." },
      { status: 400 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filePath = await saveKycFile({ userId, fileName: file.name, buffer });

  const doc = await prisma.kycDocument.create({
    data: { userId, type: "justificatif_domicile", filePath },
    select: { id: true, status: true },
  });

  // Ce document NE TOUCHE PAS `User.kycStatus` : le dossier financier a son propre statut
  // (PayoutAccount.status). Voir deriveKycStatus, qui filtre les documents d'identité.
  await recordVerificationHistory({
    subjectType: "kyc",
    subjectId: userId,
    event: "document_deposed:justificatif_domicile",
  });

  return NextResponse.json(
    { id: doc.id, status: doc.status, fileName: path.basename(filePath) },
    { status: 201 },
  );
}
