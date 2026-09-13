import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canSubmitJalonDeliverable } from "@/lib/jalons";
import { notifyMissionParties } from "@/lib/mission-notify";
import { CONSTAT_CATEGORIES } from "@/lib/constat";

// Bascule explicite d'un jalon vers `livrable_soumis`, une fois que le prestataire a attaché
// au moins une preuve via POST .../deliverable (qui n'implique plus cette bascule lui-même —
// plusieurs preuves de catégories différentes peuvent désormais s'accumuler avant l'envoi
// définitif pour validation, comme dans la maquette).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; jalonId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, jalonId } = await params;

  const contract = await prisma.prestationContract.findUnique({ where: { missionId }, include: { mission: true } });
  if (!contract || contract.providerId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 403 });
  }

  const jalon = await prisma.jalon.findUnique({ where: { id: jalonId } });
  if (!jalon || jalon.contractId !== contract.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!canSubmitJalonDeliverable(jalon.status, jalon.observedProgress)) {
    return NextResponse.json({ error: "jalon_not_ready" }, { status: 409 });
  }

  const body = (await req.json().catch(() => null)) as { comment?: unknown } | null;

  // Preuves de CONSTAT du client exclues — voir POST .../deliverable/submit.
  const proofCount = await prisma.missionAttachment.count({
    where: { jalonId: jalon.id, NOT: { category: { in: [...CONSTAT_CATEGORIES] } } },
  });
  if (proofCount === 0) {
    return NextResponse.json({ error: "no_proof_attached" }, { status: 409 });
  }

  // reviewOpenedAt repart à null — nouveau tour, pas encore consulté par le client (voir
  // POST .../review-open et la règle de synchronisation, mission-history-table.tsx).
  const updated = await prisma.jalon.update({
    where: { id: jalonId },
    data: { status: "livrable_soumis", reviewOpenedAt: null },
  });

  // Notifie le client qu'un livrable attend sa vérification (badge sidebar « À valider » +
  // fil « Activité récente » côté client, type mappé dans client-summary NOTIF_META).
  // `comment` = « Commentaire / Difficultés rencontrées » de la modale de soumission — voir
  // POST .../deliverable/submit pour le rationale.
  const comment = typeof body?.comment === "string" && body.comment.trim() ? body.comment.trim() : null;
  await notifyMissionParties({
    missionId,
    type: "deliverable_submitted",
    counterpart: {
      userId: contract.clientId,
      message: `Un livrable a été soumis pour le jalon « ${jalon.titre} » — mission « ${contract.mission.titre} ». Vérifiez les preuves puis validez ou rejetez.${comment ? ` Message du prestataire : ${comment}` : ""}`,
      email: {
        subject: `Livrable soumis — ${contract.mission.titre}`,
        text: `Le prestataire a soumis le livrable du jalon « ${jalon.titre} ». Connectez-vous pour vérifier les preuves puis valider ou rejeter.${comment ? `\n\nMessage du prestataire : ${comment}` : ""}`,
      },
    },
    actor: {
      userId,
      message: `Votre livrable du jalon « ${jalon.titre} » a été soumis — mission « ${contract.mission.titre} ». Le client va vérifier les preuves.`,
      email: {
        subject: `Livrable soumis — ${jalon.titre}`,
        text: `Votre livrable du jalon « ${jalon.titre} » (mission « ${contract.mission.titre} ») a bien été soumis. Le client va vérifier les preuves, puis valider ou demander une reprise.`,
      },
    },
  });

  return NextResponse.json({ status: updated.status });
}
