import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { shortlistTarget } from "@/lib/devis";

const schema = z.object({ shortlisted: z.boolean() });

// Présélection d'une candidature (« Shortlister », 2026-11-11) — le statut `preselectionnee`
// existait au schéma (« shortlisté par le client ») et était déjà accepté par l'acceptation,
// la messagerie et les relances, sans qu'aucune route ne permette de le poser.
//
// Réservé au client propriétaire, sur une mission encore publiée. Seule bascule permise :
// envoyee ⇄ preselectionnee (voir shortlistTarget, src/lib/devis.ts). La mise à jour porte la
// condition sur le statut de départ : si la candidature a changé entre-temps (acceptée, refusée,
// passée en négociation), rien n'est écrasé et la route répond 409.
export async function POST(req: Request, { params }: { params: Promise<{ id: string; proposalId: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, proposalId } = await params;

  const mission = await prisma.mission.findUnique({ where: { id: missionId }, select: { clientId: true, status: true } });
  if (!mission || mission.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const proposal = await prisma.missionProposal.findUnique({ where: { id: proposalId }, select: { missionId: true, status: true } });
  if (!proposal || proposal.missionId !== missionId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (mission.status !== "publiee") {
    return NextResponse.json({ error: "mission_not_open" }, { status: 409 });
  }

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const target = shortlistTarget(proposal.status, parsed.data.shortlisted);
  if (!target) {
    return NextResponse.json({ error: "cannot_shortlist" }, { status: 409 });
  }
  const { count } = await prisma.missionProposal.updateMany({
    where: { id: proposalId, status: proposal.status },
    data: { status: target },
  });
  if (count === 0) {
    return NextResponse.json({ error: "cannot_shortlist" }, { status: 409 });
  }
  return NextResponse.json({ status: target });
}
