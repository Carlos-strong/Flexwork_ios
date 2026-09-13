import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canReportMissionDeclaredProgress, isAboveProgressFloor, isValidProgress } from "@/lib/attachments";

// Pendant, au niveau MISSION ENTIÈRE (contrat SANS jalon), de
// POST /api/missions/[id]/jalons/[jalonId]/declare-progress — le prestataire déclare sa
// propre estimation d'avancement (0-100), purement déclaratif : ne gate rien côté serveur
// (voir observe-progress/escrow/release pour la garde réelle de libération des fonds, basée
// sur observedProgress, jamais sur declaredProgress).
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

  const contract = await prisma.prestationContract.findFirst({
    where: { missionId, providerId: userId },
    include: { mission: true, jalons: { select: { id: true } } },
  });
  if (!contract) {
    return NextResponse.json({ error: "not_found" }, { status: 403 });
  }
  if (contract.jalons.length > 0) {
    return NextResponse.json({ error: "use_jalon_declare_progress" }, { status: 409 });
  }
  if (!canReportMissionDeclaredProgress(contract.mission.status)) {
    return NextResponse.json({ error: "mission_not_active" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  if (!isValidProgress(body?.progress)) {
    return NextResponse.json({ error: "invalid_progress" }, { status: 400 });
  }
  const progress = Math.round(body.progress);
  // Plancher (règle de gestion des jalons, 2026-09-07) : jamais en dessous de la dernière
  // progression VALIDÉE par le client — voir isAboveProgressFloor.
  if (!isAboveProgressFloor(progress, contract.mission.observedProgress)) {
    return NextResponse.json({ error: "progress_below_floor", floor: contract.mission.observedProgress }, { status: 409 });
  }

  const updated = await prisma.mission.update({
    where: { id: missionId },
    data: { declaredProgress: progress },
  });

  return NextResponse.json({ declaredProgress: updated.declaredProgress });
}
