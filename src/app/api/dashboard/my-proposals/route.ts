import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Candidatures soumises par le prestataire connecté (MissionProposal dont il est l'auteur),
// avec un résumé de la mission visée — alimente la section "Mes candidatures" du dashboard
// prestataire (/dashboard/<role>/candidatures). Auparavant, cette vue n'existait pas :
// seul le nombre (pendingProposals) était exposé via /api/dashboard/provider-summary.
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const proposals = await prisma.missionProposal.findMany({
    where: { providerId: userId },
    include: {
      mission: {
        select: {
          id: true,
          titre: true,
          domaine: true,
          budget: true,
          currency: true,
          budgetType: true,
          status: true,
          client: { select: { id: true, firstname: true, lastname: true, country: true, avatarPath: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ items: proposals });
}
