import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { acceptProposal } from "@/lib/accept-proposal";
import { assertNoSelfDealing } from "@/lib/invariants";

// Phase 4 : le client accepte une proposition — les autres sont automatiquement refusées.
// Ne génère pas encore le contrat (voir /contract, US-402), simple sélection.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; proposalId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, proposalId } = await params;

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission || mission.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const proposal = await prisma.missionProposal.findUnique({ where: { id: proposalId } });
  if (!proposal || proposal.missionId !== missionId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Famille 4 — invariant : le client ne peut pas accepter SA propre candidature.
  if (!assertNoSelfDealing(userId, proposal.providerId)) {
    return NextResponse.json({ error: "self_dealing_forbidden" }, { status: 403 });
  }

  await acceptProposal(missionId, proposalId);

  return NextResponse.json({ ok: true });
}
