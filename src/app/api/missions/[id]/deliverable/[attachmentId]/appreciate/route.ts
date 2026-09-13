import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canDecideMission } from "@/lib/attachments";
import { notifyMissionParties } from "@/lib/mission-notify";
import { autoRejectSubmissionOperations } from "@/lib/proof-appreciation";

// Appréciation (validation ou rejet) d'UNE preuve du livrable de la mission ENTIÈRE (contrat
// SANS jalon, jalonId null) — maquette "Appréciation des preuves" (2026-09-05). Chaque preuve
// du lot courant est appréciée individuellement par le client (pré-validation) : "validee"
// (acceptée) ou "rejetee" (raison + motif ≥ 4 + demande éventuelle de nouvelle preuve —
// minimum aligné sur la modale client Flexwork-Modal-Client-Validation-Preuve.html).
// L'appréciation rend la preuve immuable (le prestataire ne peut plus la retirer) et la
// validation finale du lot exige que TOUTES les preuves ouvertes soient validées
// (assertProofsValidated, voir routes checkpoint/escrow/release).

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("validee") }),
  z.object({
    action: z.literal("rejetee"),
    reason: z.string().min(1),
    motif: z.string().min(4),
    requestNewProof: z.boolean().optional(),
  }),
]);

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, attachmentId } = await params;

  const contract = await prisma.prestationContract.findFirst({
    where: { missionId, clientId: userId },
    include: { mission: true, jalons: { select: { id: true } } },
  });
  if (!contract) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Paiement fractionné : l'appréciation se fait jalon par jalon via la route scopée.
  if (contract.jalons.length > 0) {
    return NextResponse.json({ error: "use_jalon_deliverable" }, { status: 409 });
  }
  // Fenêtre d'appréciation = fenêtre de décision du client (livrable soumis).
  if (!canDecideMission(contract.mission.status)) {
    return NextResponse.json({ error: "no_deliverable_submitted" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    // parsed.data est typé `never` sur l'échec d'une discriminatedUnion — on distingue la
    // forme rejetée via le body brut reçu (sémantique inchangée : un payload "rejetee"
    // invalide → rejection_motif_required, tout autre échec → invalid_payload).
    const wantsReject =
      typeof body === "object" && body !== null && (body as { action?: unknown }).action === "rejetee";
    return NextResponse.json(
      { error: wantsReject ? "rejection_motif_required" : "invalid_payload" },
      { status: 400 }
    );
  }

  const attachment = await prisma.missionAttachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || attachment.missionId !== missionId || attachment.jalonId !== null) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // La preuve ne doit pas avoir été close par une décision de LOT postérieure (point
  // d'étape/rejet global, append-only) — une fois écoutée, elle appartient à l'historique.
  const [checkpointAfter, rejectionAfter] = await Promise.all([
    prisma.progressCheckpoint.count({ where: { missionId, jalonId: null, createdAt: { gt: attachment.createdAt } } }),
    prisma.progressRejection.count({ where: { missionId, jalonId: null, createdAt: { gt: attachment.createdAt } } }),
  ]);
  if (checkpointAfter > 0 || rejectionAfter > 0) {
    return NextResponse.json({ error: "proof_locked" }, { status: 409 });
  }

  const previous = attachment.appreciation;
  const action = parsed.data.action;
  const reason = action === "rejetee" ? parsed.data.reason : null;
  const motif = action === "rejetee" ? parsed.data.motif : null;
  const requestNewProof = action === "rejetee" ? (parsed.data.requestNewProof ?? false) : false;

  // Rejet d'UNE preuve = rejet AUTOMATIQUE de la soumission (spec §10/14, "financement par
  // jalons à validation progressive") : en plus de rendre la preuve rejetée immuable, la
  // mission bascule `livrable_soumis` → `fonds_sous_sequestre` et un ProgressRejection
  // (append-only) est tracé — le lot rejeté devient sa propre version ("…-rej") SANS attendre
  // le « Rejeter » de lot explicite. Mêmes effets que POST .../escrow/reject (status +
  // declaredProgress 0 ; observedProgress conservé : un rejet ne défait jamais une validation
  // antérieure). Preuve rejetée et soumission rejetée dans le MÊME $transaction (atomicité).
  const ops: Prisma.PrismaPromise<any>[] = [
    prisma.missionAttachment.update({
      where: { id: attachmentId },
      data: {
        appreciation: action,
        rejectionReason: reason,
        rejectionMotif: motif,
        requestNewProof,
        appreciatedById: userId,
        appreciatedAt: new Date(),
      },
    }),
  ];
  if (action === "rejetee" && previous !== "rejetee") {
    ops.push(
      ...autoRejectSubmissionOperations(
        { missionId, jalonId: null },
        { reason: reason ?? "Preuve non conforme", rejectedById: userId }
      )
    );
  }
  const [updated] = await prisma.$transaction(ops);

  // Rejet d'une preuve → notifie le prestataire (il doit fournir une preuve corrigée /
  // resoumettre — la soumission vient d'être repartie en révision automatiquement).
  if (action === "rejetee" && previous !== "rejetee") {
    await notifyMissionParties({
      missionId,
      type: "proof_rejected",
      counterpart: {
        userId: contract.providerId,
        message: `Une preuve a été rejetée pour « ${contract.mission.titre} ». Motif : ${motif}.`,
        email: {
          subject: `Preuve rejetée — ${contract.mission.titre}`,
          text: `Le client a rejeté une de vos preuves pour la mission « ${contract.mission.titre} ». Motif : ${motif}.${requestNewProof ? " Une nouvelle preuve vous est demandée." : ""}`,
        },
      },
      actor: {
        userId,
        message: `Vous avez rejeté une preuve pour « ${contract.mission.titre} ». Motif transmis au prestataire : ${motif}.`,
        email: {
          subject: `Rejet de preuve enregistré — ${contract.mission.titre}`,
          text: `Votre rejet d'une preuve de la mission « ${contract.mission.titre} » a été enregistré et transmis au prestataire. Motif : ${motif}.${requestNewProof ? " Une nouvelle preuve lui a été demandée." : ""}`,
        },
      },
    });
  }

  return NextResponse.json({
    id: updated.id,
    appreciation: updated.appreciation,
    rejectionReason: updated.rejectionReason,
    rejectionMotif: updated.rejectionMotif,
    requestNewProof: updated.requestNewProof,
    appreciatedAt: updated.appreciatedAt,
  });
}
