import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { saveMissionAttachment } from "@/lib/storage";
import { canSubmitJalonDeliverable } from "@/lib/jalons";

// Version scopée-jalon de POST /api/missions/[id]/deliverable (US-504 côté soumission) —
// le prestataire soumet le livrable d'UN jalon financé, fait passer ce jalon (pas la
// mission entière) en `livrable_soumis`.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; jalonId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, jalonId } = await params;

  const contract = await prisma.prestationContract.findUnique({ where: { missionId } });
  if (!contract || contract.providerId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 403 });
  }

  const jalon = await prisma.jalon.findUnique({ where: { id: jalonId } });
  if (!jalon || jalon.contractId !== contract.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!canSubmitJalonDeliverable(jalon.status)) {
    return NextResponse.json({ error: "jalon_not_ready" }, { status: 409 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filePath = await saveMissionAttachment({ missionId, fileName: file.name, buffer });

  const [attachment] = await prisma.$transaction([
    prisma.missionAttachment.create({ data: { missionId, jalonId: jalon.id, uploaderId: userId, filePath } }),
    prisma.jalon.update({ where: { id: jalonId }, data: { status: "livrable_soumis" } }),
  ]);

  return NextResponse.json({ id: attachment.id });
}
