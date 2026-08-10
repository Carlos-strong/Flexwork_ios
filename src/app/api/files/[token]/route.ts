import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { readStoredFile, verifyPrivateFileToken } from "@/lib/storage";

// Sert les fichiers privés (documents de déclaration Phase 3) via URL signée à durée
// limitée, après vérification des droits d'accès (propriétaire de la déclaration,
// participant à une mission en cours avec ce prestataire, ou admin).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const decoded = verifyPrivateFileToken(token);
  if (!decoded) {
    return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 403 });
  }

  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const requesterId = (session.user as typeof session.user & { id: string }).id;
  const requester = await prisma.user.findUnique({ where: { id: requesterId } });

  if (decoded.kind === "declaration_document") {
    const doc = await prisma.declarationDocument.findUnique({
      where: { id: decoded.id },
      include: { declaration: { include: { profile: true } } },
    });
    if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Consultable par le propriétaire, par tout utilisateur authentifié (déclaration
    // publique par nature, modele-skillafrica-v3-Flexwork.md §5) et par les admins.
    const isOwner = doc.declaration.profile.userId === requesterId;
    if (!isOwner && !requester) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const buffer = await readStoredFile(doc.filePath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/octet-stream" },
    });
  }

  // Pièces jointes de mission (cahier des charges, livrable...) — même route/URL signée que
  // les documents de déclaration, restreinte au client et au(x) prestataire(s) liés à la
  // mission (candidature envoyée ou acceptée), pas "tout utilisateur authentifié".
  if (decoded.kind === "mission_attachment") {
    const attachment = await prisma.missionAttachment.findUnique({
      where: { id: decoded.id },
      include: { mission: { include: { proposals: { where: { providerId: requesterId }, select: { id: true } } } } },
    });
    if (!attachment) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const isParticipant = attachment.mission.clientId === requesterId || attachment.mission.proposals.length > 0;
    if (!isParticipant) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    const buffer = await readStoredFile(attachment.filePath);
    return new NextResponse(new Uint8Array(buffer), {
      headers: { "Content-Type": "application/octet-stream" },
    });
  }

  return NextResponse.json({ error: "unknown_kind" }, { status: 400 });
}
