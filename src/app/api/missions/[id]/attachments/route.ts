import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { saveMissionAttachment, signPrivateFileToken } from "@/lib/storage";
import { canAttachLivrable } from "@/lib/attachments";

// US-1302 : bloque les livrables joints avant acceptation d'un devis payé,
// pour empêcher le travail-test gratuit.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!canAttachLivrable(mission.status)) {
    return NextResponse.json(
      { error: "attachment_blocked_before_proposal_accepted" },
      { status: 403 }
    );
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filePath = await saveMissionAttachment({ missionId, fileName: file.name, buffer });

  const attachment = await prisma.missionAttachment.create({
    data: { missionId, uploaderId: userId, filePath },
  });

  return NextResponse.json({ id: attachment.id });
}

// Liste des pièces jointes — accessible au client et au(x) prestataire(s) liés à la
// mission (candidature envoyée ou acceptée), pour rester cohérent avec la restriction déjà
// appliquée à la lecture d'un fichier signé (voir /api/files/[token]).
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    include: { proposals: { where: { providerId: userId }, select: { id: true } } },
  });
  if (!mission) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const isParticipant = mission.clientId === userId || mission.proposals.length > 0;
  if (!isParticipant) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const attachments = await prisma.missionAttachment.findMany({
    where: { missionId },
    orderBy: { createdAt: "asc" },
  });
  const uploaders = await prisma.user.findMany({
    where: { id: { in: [...new Set(attachments.map((a) => a.uploaderId))] } },
    select: { id: true, email: true },
  });
  const emailById = new Map(uploaders.map((u) => [u.id, u.email]));

  return NextResponse.json({
    items: attachments.map((a) => ({
      id: a.id,
      fileName: a.filePath.split("/").pop(),
      uploaderEmail: emailById.get(a.uploaderId) ?? null,
      createdAt: a.createdAt,
      url: `/api/files/${signPrivateFileToken("mission_attachment", a.id)}`,
    })),
  });
}
