import path from "path";
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { readStoredFile, verifyKycDocToken } from "@/lib/storage";

// Type MIME selon l'extension — permet la prévisualisation des images/PDF (admin KYC, page
// /kyc) au lieu d'un téléchargement octet-stream systématique. Les fichiers sont privés et
// uniquement servis via cette URL signée (propriétaire ou admin KYC).
const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".pdf": "application/pdf",
};

// Sert un document KYC uniquement via une URL signée à durée limitée (5 min),
// et uniquement au propriétaire du document ou à un admin KYC.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const decoded = verifyKycDocToken(token);
  if (!decoded) {
    return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 403 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const requesterId = (session.user as typeof session.user & { id: string }).id;

  const doc = await prisma.kycDocument.findUnique({ where: { id: decoded.docId } });
  if (!doc) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const requester = await prisma.user.findUnique({ where: { id: requesterId } });
  const isOwner = doc.userId === requesterId;
  // Séparation des pouvoirs (§13) : une pièce d'identité ne s'ouvre qu'au rôle qui instruit les
  // dossiers. `isAdmin` seul laissait la modération, la médiation, l'éditeur du site — et un
  // admin sans rôle — lire les documents d'identité que leur écran ne leur montre jamais.
  const isKycAdmin = requester?.isAdmin === true && requester.adminRole === "kyc";
  if (!isOwner && !isKycAdmin) {
    // 404 (pas 403) : un tiers ne doit pas savoir que le document KYC existe.
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const buffer = await readStoredFile(doc.filePath);
  const ext = path.extname(doc.filePath).toLowerCase();
  const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";
  return new NextResponse(new Uint8Array(buffer), {
    headers: { "Content-Type": contentType, "Content-Disposition": "inline" },
  });
}
