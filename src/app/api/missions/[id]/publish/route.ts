import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireVerifiedKyc } from "@/lib/kycGuard";
import { announcePublication, publishBlocker } from "@/lib/mission-publish";

// Publication d'un BROUILLON existant (2026-10-06) — typiquement celui enregistré quand le
// client a cliqué « Publier » avant que son identité soit vérifiée. Mêmes conditions et mêmes
// effets que la publication directe (src/lib/mission-publish.ts) : identité vérifiée, mission
// conforme aux règles de publication, puis prestataires du domaine notifiés.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireVerifiedKyc();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { id } = await params;

  const mission = await prisma.mission.findUnique({
    where: { id },
    select: {
      id: true,
      clientId: true,
      titre: true,
      domaine: true,
      status: true,
      budget: true,
      budgetType: true,
      financingModeKey: true,
      timeRate: true,
      timeMaxQuantity: true,
    },
  });
  // Mission d'un autre client : même réponse qu'une mission inexistante — l'existence d'un
  // brouillon d'autrui n'a pas à se deviner.
  if (!mission || mission.clientId !== guard.userId) {
    return NextResponse.json({ error: "mission_not_found" }, { status: 404 });
  }
  if (mission.status !== "brouillon") {
    return NextResponse.json({ error: "mission_not_draft" }, { status: 409 });
  }

  const blocker = publishBlocker(mission);
  if (blocker) {
    return NextResponse.json(blocker, { status: 400 });
  }

  // Passage atomique brouillon → publiée : un double clic ou deux onglets ne publient (et ne
  // notifient) qu'une seule fois.
  const { count } = await prisma.mission.updateMany({
    where: { id: mission.id, clientId: guard.userId, status: "brouillon" },
    data: { status: "publiee", publicationRequestedAt: null },
  });
  if (count === 0) {
    return NextResponse.json({ error: "mission_not_draft" }, { status: 409 });
  }

  await announcePublication(mission, guard.userId);
  return NextResponse.json({ id: mission.id, status: "publiee" });
}
