import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Proposition du prestataire connecté sur une mission (mode devis QUOTE) — inclut le devis
// courant et l'historique des révisions. Retourne `null` si le prestataire n'a pas candidaté.
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

  const proposal = await prisma.missionProposal.findUnique({
    where: { missionId_providerId: { missionId, providerId: userId } },
    include: {
      provider: { select: { id: true, email: true } },
      revisions: {
        include: { author: { select: { firstname: true, lastname: true } } },
        orderBy: { roundNumber: "asc" },
      },
    },
  });

  return NextResponse.json(proposal);
}
