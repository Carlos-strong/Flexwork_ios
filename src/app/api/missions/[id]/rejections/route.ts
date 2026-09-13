import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Historique des REJETS de soumission ("validation partielle" côté rejet, voir .../reject) —
// pendant de GET .../checkpoints, même restriction d'accès (consultable par les DEUX parties
// du contrat) : le prestataire doit voir CHAQUE motif de rejet passé, pas seulement le dernier
// (Jalon.rejectionReason, écrasé à chaque nouveau rejet — voir ProgressRejection,
// append-only).
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

  const contract = await prisma.prestationContract.findUnique({ where: { missionId } });
  if (!contract || (contract.clientId !== userId && contract.providerId !== userId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const rejections = await prisma.progressRejection.findMany({
    where: { missionId },
    orderBy: { createdAt: "desc" },
    include: {
      rejectedBy: { select: { firstname: true, lastname: true } },
      jalon: { select: { titre: true, ordre: true } },
    },
  });

  return NextResponse.json({
    items: rejections.map((r) => ({
      id: r.id,
      jalonId: r.jalonId,
      jalonTitre: r.jalon?.titre ?? null,
      jalonOrdre: r.jalon?.ordre ?? null,
      reason: r.reason,
      rejectedByName: [r.rejectedBy.firstname, r.rejectedBy.lastname].filter(Boolean).join(" ") || "Client",
      createdAt: r.createdAt,
    })),
  });
}
