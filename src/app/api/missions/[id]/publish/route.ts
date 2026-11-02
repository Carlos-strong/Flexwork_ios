import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { clientPublicationRight } from "@/lib/kyc-policy";
import { announcePublication, publishBlocker } from "@/lib/mission-publish";

// Publication d'un BROUILLON existant (2026-10-06) — typiquement celui enregistré quand le
// client a cliqué « Publier » et que les contrôles d'identité l'ont retenu. Mêmes conditions et
// mêmes effets que la publication directe (src/lib/mission-publish.ts) : mission conforme aux
// règles de publication, contrôles d'identité (src/lib/kyc-policy.ts), puis prestataires du
// domaine notifiés.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
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
  if (!mission || mission.clientId !== userId) {
    return NextResponse.json({ error: "mission_not_found" }, { status: 404 });
  }
  if (mission.status !== "brouillon") {
    return NextResponse.json({ error: "mission_not_draft" }, { status: 409 });
  }

  const blocker = publishBlocker(mission);
  if (blocker) {
    return NextResponse.json(blocker, { status: 400 });
  }
  const right = await clientPublicationRight(userId);
  if (!right.ok) {
    return NextResponse.json({ error: right.error, message: right.message }, { status: 403 });
  }

  // Passage atomique brouillon → publiée : un double clic ou deux onglets ne publient (et ne
  // notifient) qu'une seule fois.
  const { count } = await prisma.mission.updateMany({
    where: { id: mission.id, clientId: userId, status: "brouillon" },
    data: { status: "publiee", publicationRequestedAt: null },
  });
  if (count === 0) {
    return NextResponse.json({ error: "mission_not_draft" }, { status: 409 });
  }

  await announcePublication(mission, userId);
  return NextResponse.json({ id: mission.id, status: "publiee" });
}
