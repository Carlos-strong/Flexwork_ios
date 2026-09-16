import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canSubmitDeliverable } from "@/lib/attachments";
import { notifyMissionParties } from "@/lib/mission-notify";
import { CONSTAT_CATEGORIES } from "@/lib/constat";

// Bascule explicite de la mission ENTIÈRE (contrat SANS jalon) vers `livrable_soumis`, une
// fois que le prestataire a attaché au moins une preuve via POST .../deliverable (qui n'im-
// plique plus cette bascule lui-même). Pendant, au niveau mission, de
// POST /api/missions/[id]/jalons/[jalonId]/submit pour le cas fractionné.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const contract = await prisma.prestationContract.findFirst({
    where: { missionId, OR: [{ clientId: userId }, { providerId: userId }] },
    include: { mission: true, jalons: { select: { id: true } } },
  });
  if (!contract) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (contract.providerId !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (contract.jalons.length > 0) {
    return NextResponse.json({ error: "use_jalon_deliverable" }, { status: 409 });
  }
  if (!canSubmitDeliverable(contract.mission.status)) {
    return NextResponse.json({ error: "mission_not_ready" }, { status: 409 });
  }
  // Même garde que POST .../deliverable — voir ce fichier pour le rationale complet.
  if (contract.mission.status === "livrable_soumis" && contract.mission.observedProgress >= 100) {
    return NextResponse.json({ error: "review_complete" }, { status: 409 });
  }

  const body = (await req.json().catch(() => null)) as { comment?: unknown } | null;

  // Preuves de CONSTAT du client exclues — seules les preuves du prestataire comptent pour
  // lever `no_proof_attached` (voir src/lib/constat.ts).
  const proofCount = await prisma.missionAttachment.count({
    where: { missionId, jalonId: null, NOT: { category: { in: [...CONSTAT_CATEGORIES] } } },
  });
  if (proofCount === 0) {
    return NextResponse.json({ error: "no_proof_attached" }, { status: 409 });
  }

  // reviewOpenedAt repart à null — nouveau tour, pas encore consulté par le client (voir
  // POST .../review-open et la règle de synchronisation, mission-history-table.tsx).
  const updated = await prisma.mission.update({
    where: { id: missionId },
    data: { status: "livrable_soumis", reviewOpenedAt: null, submittedAt: new Date() },
  });

  // Notifie le client qu'un livrable attend sa vérification (contrat SANS jalon).
  // `comment` = « Commentaire / Difficultés rencontrées » de la modale de soumission
  // (Flexwork-Modal-Prestataire-Soumission.html) : un mot du prestataire adressé au client,
  // transporté par cette notification plutôt que stocké dans un champ propre — c'est
  // exactement le canal auquel il est destiné (le client le lit au moment de vérifier).
  const comment = typeof body?.comment === "string" && body.comment.trim() ? body.comment.trim() : null;
  await notifyMissionParties({
    missionId,
    type: "deliverable_submitted",
    counterpart: {
      userId: contract.clientId,
      message: `Un livrable a été soumis pour validation — mission « ${contract.mission.titre} ». Vérifiez les preuves puis validez ou rejetez.${comment ? ` Message du prestataire : ${comment}` : ""}`,
      email: {
        subject: `Livrable soumis — ${contract.mission.titre}`,
        text: `Le prestataire a soumis le livrable. Connectez-vous pour vérifier les preuves puis valider ou rejeter.${comment ? `\n\nMessage du prestataire : ${comment}` : ""}`,
      },
    },
    actor: {
      userId,
      message: `Votre livrable a été soumis pour « ${contract.mission.titre} » — le client va vérifier les preuves.`,
      email: {
        subject: `Livrable soumis — ${contract.mission.titre}`,
        text: `Votre livrable pour la mission « ${contract.mission.titre} » a bien été soumis. Le client va vérifier les preuves, puis valider ou demander une reprise.`,
      },
    },
  });

  return NextResponse.json({ status: updated.status });
}
