import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canClientRequestRevision } from "@/lib/devis";
import { notifyMissionParties } from "@/lib/mission-notify";

// Le client demande explicitement une révision du devis en cours — c'est CETTE action, et
// uniquement elle, qui fait réapparaître la carte "Réviser le devis" côté prestataire
// (voir canProviderReviseDevis, src/lib/devis.ts). Message optionnel pour préciser ce qui
// doit changer (repris tel quel, pas de motif obligatoire — contrairement au rejet d'un
// jalon, ceci reste une négociation, pas un refus).
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

  if (
    !canClientRequestRevision({
      hasDevis: !!proposal.devisData,
      status: proposal.status,
      revisionAlreadyRequested: !!proposal.revisionRequestedAt,
    })
  ) {
    return NextResponse.json({ error: "cannot_request_revision" }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));
  const message = typeof body?.message === "string" && body.message.trim() ? body.message.trim() : null;

  const updated = await prisma.missionProposal.update({
    where: { id: proposalId },
    data: { revisionRequestedAt: new Date(), revisionRequestMessage: message },
  });

  // Cloche + e-mail pour les deux parties (2026-09-09) : c'est une demande d'action adressée
  // au prestataire, elle ne peut pas rester visible seulement dans son dashboard.
  await notifyMissionParties({
    missionId,
    type: "devis_revision_demandee",
    counterpart: {
      userId: proposal.providerId,
      message: `Le client demande une révision de votre devis pour « ${mission.titre} »${message ? ` : ${message}` : "."}`,
      email: {
        subject: `Révision demandée — ${mission.titre}`,
        text: `Le client demande une nouvelle version de votre devis pour la mission « ${mission.titre} ».${message ? `\n\nSa demande : ${message}` : ""}\n\nConnectez-vous pour soumettre votre devis révisé.`,
      },
    },
    actor: {
      userId,
      message: `Vous avez demandé une révision du devis pour « ${mission.titre} » — le prestataire doit soumettre une nouvelle version.`,
      email: {
        subject: `Demande de révision envoyée — ${mission.titre}`,
        text: `Votre demande de révision du devis pour la mission « ${mission.titre} » a été transmise au prestataire.${message ? `\n\nVotre message : ${message}` : ""}`,
      },
    },
  });

  return NextResponse.json({ revisionRequestedAt: updated.revisionRequestedAt });
}
