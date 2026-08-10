import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/adminGuard";

// Lecture pure de mission.status — aucune logique de statut dupliquée ici. Le cycle v3
// (Prompts_Sprints_UserStories.md, Phase 4-6) est volontairement court par rapport à
// l'ancien Kanban 16 statuts, qui encodait un escrow interne désormais supprimé.
export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const missions = await prisma.mission.findMany({
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      titre: true,
      status: true,
      budget: true,
      client: { select: { email: true } },
      contract: {
        select: { mediations: { where: { outcome: "en_cours" }, select: { id: true } } },
      },
    },
  });

  return NextResponse.json({
    items: missions.map((m) => ({
      id: m.id,
      titre: m.titre,
      status: m.status,
      budget: m.budget,
      client: m.client,
      mediationEnCours: (m.contract?.mediations.length ?? 0) > 0,
    })),
  });
}
