import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Pendant, au niveau MISSION ENTIÈRE (contrat sans jalon), de
// POST /api/missions/[id]/jalons/[jalonId]/review-open — voir ce fichier pour le rationale
// complet.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const contract = await prisma.prestationContract.findFirst({
    where: { missionId, clientId: userId },
    include: { jalons: { select: { id: true } } },
  });
  if (!contract) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (contract.jalons.length > 0) {
    return NextResponse.json({ error: "use_jalon_review_open" }, { status: 409 });
  }

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (mission.status !== "livrable_soumis" || mission.reviewOpenedAt) {
    return NextResponse.json({ reviewOpenedAt: mission.reviewOpenedAt });
  }

  const updated = await prisma.mission.update({
    where: { id: missionId },
    data: { reviewOpenedAt: new Date() },
  });

  return NextResponse.json({ reviewOpenedAt: updated.reviewOpenedAt });
}
