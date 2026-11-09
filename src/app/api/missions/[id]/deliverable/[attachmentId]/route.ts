import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { deleteStoredFile } from "@/lib/storage";

// Retrait d'une preuve du livrable de la mission ENTIÈRE (contrat SANS jalon, jalonId null),
// tant qu'elle est encore OUVERTE — pendant, au niveau mission, de
// DELETE /api/missions/[id]/jalons/[jalonId]/deliverable/[attachmentId]. Le prestataire peut
// enlever une preuve qu'il vient d'ajouter au tour courant tant qu'aucune décision ne l'a
// close ; dès qu'une décision du client (point d'étape confirmé ou rejet, append-only) est
// POSTÉRIEURE à la preuve, celle-ci fait partie de l'historique (immutable) et n'est plus
// supprimable — on ne falsifie jamais une validation/rejet déjà rendue.
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, attachmentId } = await params;

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

  const attachment = await prisma.missionAttachment.findUnique({ where: { id: attachmentId } });
  if (!attachment || attachment.missionId !== missionId || attachment.jalonId !== null) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (attachment.uploaderId !== userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Une preuve déjà appréciée par le client (validée/rejetée) est immuable : on ne retire
  // jamais une preuve sur laquelle une décision a été rendue (2026-09-05).
  if (attachment.appreciation) {
    return NextResponse.json({ error: "proof_locked" }, { status: 409 });
  }

  // Fenêtre de suppression = fenêtre où le prestataire peut encore soumettre des preuves sur
  // la mission (fonds séquestrés / en cours / livrable_soumis en validation PARTIELLE). Une
  // fois 100 % constatés ou la mission décidée, place à la clôture, plus d'édition.
  const st = contract.mission.status;
  const canDeleteState =
    st === "fonds_sous_sequestre" ||
    st === "en_cours" ||
    (st === "livrable_soumis" && contract.mission.observedProgress > 0 && contract.mission.observedProgress < 100);
  if (!canDeleteState) {
    return NextResponse.json({ error: "proof_locked" }, { status: 409 });
  }

  // La preuve ne doit avoir été close par AUCUNE décision postérieure (point d'étape/rejet).
  const [checkpointAfter, rejectionAfter] = await Promise.all([
    prisma.progressCheckpoint.count({ where: { missionId, jalonId: null, createdAt: { gt: attachment.createdAt } } }),
    prisma.progressRejection.count({ where: { missionId, jalonId: null, createdAt: { gt: attachment.createdAt } } }),
  ]);
  if (checkpointAfter > 0 || rejectionAfter > 0) {
    return NextResponse.json({ error: "proof_locked" }, { status: 409 });
  }

  // Preuves texte-seules (géolocalisation / "autres preuves") : préfixe __no_file__, aucun
  // fichier réel à retirer du stockage.
  if (!attachment.filePath.startsWith("__no_file__/")) {
    await deleteStoredFile(attachment.filePath);
  }
  await prisma.missionAttachment.delete({ where: { id: attachmentId } });

  return NextResponse.json({ id: attachmentId });
}
