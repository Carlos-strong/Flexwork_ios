import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canClientRejectDevis } from "@/lib/devis";
import { notifyMissionParties } from "@/lib/mission-notify";

const schema = z.object({ reason: z.string().min(1) });

// Le client rejette explicitement le devis d'UNE candidature — motif obligatoire (même
// exigence que le rejet d'un jalon, src/app/api/missions/[id]/jalons/[jalonId]/reject).
// Distinct du passage à "refusee" posé en effet de bord par POST .../devis/validate sur les
// AUTRES candidatures lors de l'acceptation d'une proposition : ici c'est un geste explicite
// du client sur CETTE candidature précise, avec sa propre justification conservée.
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

  if (!canClientRejectDevis(proposal.status)) {
    return NextResponse.json({ error: "cannot_reject" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "reason_required" }, { status: 400 });
  }

  const updated = await prisma.missionProposal.update({
    where: { id: proposalId },
    data: {
      status: "refusee",
      devisRejectedAt: new Date(),
      devisRejectionReason: parsed.data.reason,
      // La négociation est close : une demande de révision encore ouverte n'a plus d'objet.
      // Sans ce nettoyage, la candidature refusée continuait d'afficher « Révision demandée »
      // et invitait le prestataire à resoumettre dans le vide (src/lib/proposal-status.ts).
      revisionRequestedAt: null,
      revisionRequestMessage: null,
    },
  });

  // Cloche + e-mail pour les deux parties (2026-09-09) : un rejet motivé doit atteindre le
  // prestataire, pas seulement changer la couleur d'une carte.
  await notifyMissionParties({
    missionId,
    type: "devis_rejete",
    counterpart: {
      userId: proposal.providerId,
      message: `Votre devis pour « ${mission.titre} » a été rejeté. Motif : ${parsed.data.reason}`,
      email: {
        subject: `Devis rejeté — ${mission.titre}`,
        text: `Le client a rejeté votre devis pour la mission « ${mission.titre} ».\n\nMotif : ${parsed.data.reason}`,
      },
    },
    actor: {
      userId,
      message: `Vous avez rejeté le devis pour « ${mission.titre} ». Motif transmis au prestataire : ${parsed.data.reason}`,
      email: {
        subject: `Rejet de devis enregistré — ${mission.titre}`,
        text: `Votre rejet du devis pour la mission « ${mission.titre} » a été enregistré et transmis au prestataire.\n\nMotif : ${parsed.data.reason}`,
      },
    },
  });

  return NextResponse.json({ status: updated.status });
}
