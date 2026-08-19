import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { saveMessageFile, signPrivateFileToken } from "@/lib/storage";

// POST /api/messages/upload — envoie un fichier dans une conversation.
// Body : multipart/form-data avec `missionId` (string) et `file` (File).
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 Mo

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const formData = await req.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const missionId = formData.get("missionId");
  const file = formData.get("file");
  if (typeof missionId !== "string" || !missionId || !(file instanceof File)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "file_too_large" }, { status: 413 });
  }

  // Vérifier la participation (client de la mission OU prestataire ayant candidaté)
  const mission = await prisma.mission.findUnique({
    where: { id: missionId },
    select: {
      clientId: true,
      proposals: { where: { providerId: userId }, select: { id: true } },
    },
  });
  if (!mission) return NextResponse.json({ error: "mission_not_found" }, { status: 404 });

  const isParticipant = mission.clientId === userId || mission.proposals.length > 0;
  if (!isParticipant) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const filePath = await saveMessageFile({ missionId, fileName: file.name, buffer });

  const message = await prisma.message.create({
    data: {
      missionId,
      senderId: userId,
      content: file.name,
      type: "file",
      fileName: file.name,
      filePath,
      fileSize: file.size,
      mimeType: file.type || "application/octet-stream",
    },
    select: {
      id: true, content: true, createdAt: true,
      type: true, fileName: true, fileSize: true, mimeType: true,
    },
  });

  return NextResponse.json({
    message: {
      id: message.id,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      sent: true,
      type: message.type,
      fileName: message.fileName,
      fileSize: message.fileSize,
      mimeType: message.mimeType,
      url: `/api/files/${signPrivateFileToken("message_file", message.id)}`,
    },
  });
}
