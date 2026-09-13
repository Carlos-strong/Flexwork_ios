import { NextResponse } from "next/server";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canDecideJalon } from "@/lib/jalons";
import { notifyMissionParties } from "@/lib/mission-notify";
import { autoRejectSubmissionOperations } from "@/lib/proof-appreciation";

// Version scopée-jalon de POST /api/missions/[id]/deliverable/[attachmentId]/appreciate :
// appréciation (validation ou rejet) d'UNE preuve du livrable d'UN jalon — voir ce fichier
// pour le modèle (2026-09-05, maquette "Appréciation des preuves").

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
  { params }: { params: Promise<{ id: string; jalonId: string; attachmentId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, jalonId, attachmentId } = await params;

  const contract = await prisma.prestationContract.findUnique({ where: { missionId }, include: { mission: true } });
  if (!contract || contract.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const jalon = await prisma.jalon.findUnique({ where: { id: jalonId } });
  if (!jalon || jalon.contractId !== contract.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!canDecideJalon(jalon.status)) {
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
  if (!attachment || attachment.missionId !== missionId || attachment.jalonId !== jalonId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // La preuve ne doit pas avoir été close par une décision de LOT postérieure (point
  // d'étape/rejet global du jalon, append-only).
  const [checkpointAfter, rejectionAfter] = await Promise.all([
    prisma.progressCheckpoint.count({ where: { missionId, jalonId, createdAt: { gt: attachment.createdAt } } }),
    prisma.progressRejection.count({ where: { missionId, jalonId, createdAt: { gt: attachment.createdAt } } }),
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
  // jalons à validation progressive") : en plus de rendre la preuve rejetée immuable, le jalon
  // bascule `livrable_soumis` → `rejete` et un ProgressRejection (append-only) est tracé — le
  // lot rejeté devient sa propre version ("…-rej") SANS attendre le « Rejeter » de lot
  // explicite. Mêmes effets que POST .../jalons/[jalonId]/reject (status, rejectionReason,
  // revisionCount +1, declaredProgress 0 ; observedProgress conservé). Preuve rejetée et
  // soumission rejetée dans le MÊME $transaction (atomicité).
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
        { missionId, jalonId },
        { reason: reason ?? "Preuve non conforme", rejectedById: userId }
      )
    );
  }
  const [updated] = await prisma.$transaction(ops);

  // Rejet d'une preuve → notifie le prestataire (il doit fournir une preuve corrigée /
  // resoumettre — la soumission du jalon vient d'être repartie en révision automatiquement).
  if (action === "rejetee" && previous !== "rejetee") {
    await notifyMissionParties({
      missionId,
      type: "proof_rejected",
      counterpart: {
        userId: contract.providerId,
        message: `Une preuve du jalon « ${jalon.titre} » a été rejetée. Motif : ${motif}.`,
        email: {
          subject: `Preuve rejetée — ${jalon.titre}`,
          text: `Le client a rejeté une de vos preuves pour le jalon « ${jalon.titre} » de la mission « ${contract.mission.titre} ». Motif : ${motif}.${requestNewProof ? " Une nouvelle preuve vous est demandée." : ""}`,
        },
      },
      actor: {
        userId,
        message: `Vous avez rejeté une preuve du jalon « ${jalon.titre} ». Motif transmis au prestataire : ${motif}.`,
        email: {
          subject: `Rejet de preuve enregistré — ${jalon.titre}`,
          text: `Votre rejet d'une preuve du jalon « ${jalon.titre} » (mission « ${contract.mission.titre} ») a été enregistré et transmis au prestataire. Motif : ${motif}.`,
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
