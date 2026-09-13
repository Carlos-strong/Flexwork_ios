import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isConstatCategory } from "@/lib/constat";

// Retrait d'une preuve de CONSTAT — réservé à son auteur (le client du contrat). Contrairement
// aux preuves du prestataire, aucune notion d'appréciation ne les fige : le constat appartient
// au client, il le compose librement tant qu'il le rédige.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, attachmentId } = await params;

  const attachment = await prisma.missionAttachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || attachment.missionId !== missionId || !isConstatCategory(attachment.category)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (attachment.uploaderId !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  await prisma.missionAttachment.delete({ where: { id: attachmentId } });
  return NextResponse.json({ ok: true });
}
