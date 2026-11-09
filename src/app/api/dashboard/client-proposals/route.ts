import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Propositions (MissionProposal) REÇUES sur les missions du client connecté — alimente la
// section « Propositions » du dashboard client (/client/propositions), miroir client de
// /api/dashboard/my-proposals (côté prestataire, qui liste les candidatures envoyées).
// Chaque proposition est enrichie du PRESTATAIRE (identité réelle) et d'un résumé de la
// mission ciblée — même sélecteurs que la vue candidature par mission (GET
// /api/missions/[id]/proposals).
export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;

  const proposals = await prisma.missionProposal.findMany({
    where: { mission: { clientId: userId } },
    include: {
      provider: { select: { id: true, firstname: true, lastname: true, country: true, avatarPath: true } },
      mission: {
        select: {
          id: true,
          titre: true,
          domaine: true,
          budget: true,
          currency: true,
          budgetType: true,
          status: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({ items: proposals });
}
