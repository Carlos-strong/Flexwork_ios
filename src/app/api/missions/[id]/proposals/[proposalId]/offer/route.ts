import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { notifyMissionParties } from "@/lib/mission-notify";
import { offerSchema } from "@/lib/validation";

// Le client envoie une offre formelle à un candidat, à partir d'une candidature déjà reçue
// (model Offer, prisma/schema.prisma — jamais exposé côté API avant cette route). Réutilise
// missionId/providerId déjà connus via la candidature plutôt qu'un flux de recherche de
// prestataire séparé à inventer.
export async function POST(
  req: Request,
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

  const body = await req.json().catch(() => null);
  const parsed = offerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const offer = await prisma.offer.create({
    data: {
      missionId,
      clientId: userId,
      providerId: proposal.providerId,
      proposalId,
      titre: parsed.data.titre,
      description: parsed.data.description,
      montant: parsed.data.montant,
      currency: mission.currency,
      milestones: parsed.data.milestones ?? undefined,
      status: "envoyee",
      sentAt: new Date(),
    },
  });

  // Cloche + e-mail pour les deux parties (2026-09-09) : une offre formelle attend une
  // réponse du prestataire, elle ne peut pas n'exister que dans une liste.
  await notifyMissionParties({
    missionId,
    type: "offre_recue",
    counterpart: {
      userId: proposal.providerId,
      message: `Offre reçue pour « ${mission.titre} » — ${Math.round(offer.montant).toLocaleString("fr-FR")} ${offer.currency}. Acceptez-la ou refusez-la depuis vos offres.`,
      email: {
        subject: `Offre reçue — ${mission.titre}`,
        text: `Le client vous adresse une offre formelle pour la mission « ${mission.titre} » : ${Math.round(offer.montant).toLocaleString("fr-FR")} ${offer.currency}. Connectez-vous pour l'accepter ou la refuser.`,
      },
    },
    actor: {
      userId,
      message: `Votre offre pour « ${mission.titre} » a été envoyée au prestataire — ${Math.round(offer.montant).toLocaleString("fr-FR")} ${offer.currency}.`,
      email: {
        subject: `Offre envoyée — ${mission.titre}`,
        text: `Votre offre pour la mission « ${mission.titre} » a été transmise au prestataire. Vous serez notifié dès qu'il y aura répondu.`,
      },
    },
  });

  return NextResponse.json(offer);
}
