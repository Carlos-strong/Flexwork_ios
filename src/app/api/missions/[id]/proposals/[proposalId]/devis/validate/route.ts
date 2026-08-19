import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// Le client valide le devis d'une proposition en négociation → "devis_valide".
// Les autres propositions encore ouvertes sont refusées (même règle que l'acceptation
// classique) ; la génération de contrat (POST /api/missions/[id]/contract) accepte
// ensuite ce statut.
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
  if (proposal.status !== "en_negociation") {
    return NextResponse.json({ error: "not_in_negotiation" }, { status: 409 });
  }
  if (!proposal.devisData) {
    return NextResponse.json({ error: "no_devis" }, { status: 409 });
  }

  await prisma.$transaction([
    prisma.missionProposal.update({
      where: { id: proposalId },
      data: { status: "devis_valide", devisValideAt: new Date() },
    }),
    prisma.missionProposal.updateMany({
      where: {
        missionId,
        id: { not: proposalId },
        status: { in: ["envoyee", "preselectionnee", "en_negociation"] },
      },
      data: { status: "refusee" },
    }),
    // Même transition que l'acceptation classique : la validation du devis vaut sélection
    // du prestataire, ce qui déclenche le parcours de génération de contrat existant.
    prisma.mission.update({
      where: { id: missionId },
      data: { status: "proposition_acceptee" },
    }),
  ]);

  return NextResponse.json({ ok: true });
}
