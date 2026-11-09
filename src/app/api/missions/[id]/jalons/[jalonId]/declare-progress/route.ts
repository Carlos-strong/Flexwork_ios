import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canReportDeclaredProgress, isAboveProgressFloor, isValidProgress } from "@/lib/jalons";

// Le prestataire déclare sa propre estimation d'avancement (0-100) sur un jalon — purement
// déclaratif, ne gate rien côté serveur (voir observe-progress/validate pour la garde réelle
// de libération des fonds, basée sur observedProgress, jamais sur declaredProgress).
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
  if (!canReportDeclaredProgress(jalon.status)) {
    return NextResponse.json({ error: "jalon_not_active" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  if (!isValidProgress(body?.progress)) {
    return NextResponse.json({ error: "invalid_progress" }, { status: 400 });
  }
  const progress = Math.round(body.progress);
  // Plancher (règle de gestion des jalons, 2026-09-07) : jamais en dessous de la dernière
  // progression VALIDÉE par le client — voir isAboveProgressFloor.
  if (!isAboveProgressFloor(progress, jalon.observedProgress)) {
    return NextResponse.json({ error: "progress_below_floor", floor: jalon.observedProgress }, { status: 409 });
  }

  const updated = await prisma.jalon.update({
    where: { id: jalonId },
    data: { declaredProgress: progress },
  });

  return NextResponse.json({ declaredProgress: updated.declaredProgress });
}
