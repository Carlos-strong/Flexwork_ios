import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { saveMissionAttachment } from "@/lib/storage";
import { canAttachLivrable } from "@/lib/attachments";

// Phase 4/5 : le prestataire soumet le livrable — fait passer la mission en
// `livrable_soumis`, précondition à l'instruction RELEASE (US-504).
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

  const contract = await prisma.prestationContract.findUnique({
    where: { missionId },
    include: { mission: true, jalons: { select: { id: true } } },
  });
  if (!contract || contract.providerId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 403 });
  }
  // Paiement fractionné (2026-08-06) : le livrable se soumet jalon par jalon via
  // POST /api/missions/[id]/jalons/[jalonId]/deliverable.
  if (contract.jalons.length > 0) {
    return NextResponse.json({ error: "use_jalon_deliverable" }, { status: 409 });
  }
  if (!canAttachLivrable(contract.mission.status)) {
    return NextResponse.json({ error: "mission_not_ready" }, { status: 409 });
  }

  const formData = await req.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const filePath = await saveMissionAttachment({ missionId, fileName: file.name, buffer });

  const [attachment] = await prisma.$transaction([
    prisma.missionAttachment.create({ data: { missionId, uploaderId: userId, filePath } }),
    prisma.mission.update({ where: { id: missionId }, data: { status: "livrable_soumis" } }),
  ]);

  return NextResponse.json({ id: attachment.id });
}
