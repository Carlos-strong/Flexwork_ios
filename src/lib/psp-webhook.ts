import { prisma } from "@/lib/db";
import { verifyWebhookSignatureGeneric } from "@/lib/webhook-signing";

export type PspWebhookPayload = {
  pspReference: string;
  event: "hold_confirmed" | "release_confirmed" | "freeze_confirmed" | "refund_confirmed" | "failed";
};

export type ApplyResult = { ok: true } | { ok: false; error: string };

// US-503 (Phase 5) — seule source de confirmation d'un mouvement d'escrow : le webhook
// signé du PSP. Aucune route admin de confirmation manuelle n'existe côté plateforme — la
// plateforme n'a jamais détenu les fonds, elle ne fait qu'enregistrer la confirmation reçue.
export async function applyPspWebhookEvent(payload: PspWebhookPayload, signature: string): Promise<ApplyResult> {
  if (!verifyWebhookSignatureGeneric(payload, signature)) {
    return { ok: false, error: "invalid_signature" };
  }

  const operation = await prisma.pspEscrowOperation.findUnique({
    where: { pspReference: payload.pspReference },
    include: { contract: true },
  });
  if (!operation) return { ok: false, error: "operation_not_found" };

  if (payload.event === "failed") {
    await prisma.pspEscrowOperation.update({
      where: { id: operation.id },
      data: { status: "failed" },
    });
    return { ok: true };
  }

  await prisma.pspEscrowOperation.update({
    where: { id: operation.id },
    data: { status: "confirmed", pspConfirmedAt: new Date(), webhookReference: payload.event },
  });

  // Paiement fractionné (2026-08-06) : une opération scopée à un jalon (jalonId non nul) met
  // à jour CE jalon, pas le statut agrégé de la mission de façon optimiste — la mission ne
  // passe `cloturee` qu'une fois TOUS les jalons du contrat `libere` (vérifié ci-dessous).
  if (operation.jalonId) {
    if (operation.instructionType === "hold") {
      await prisma.jalon.update({ where: { id: operation.jalonId }, data: { status: "fonds_sous_sequestre" } });
      await prisma.mission.updateMany({
        where: { id: operation.contract.missionId, status: { notIn: ["fonds_sous_sequestre", "livrable_soumis", "validee", "cloturee"] } },
        data: { status: "fonds_sous_sequestre" },
      });
    } else if (operation.instructionType === "release") {
      await prisma.jalon.update({ where: { id: operation.jalonId }, data: { status: "libere" } });
      const remaining = await prisma.jalon.count({
        where: { contractId: operation.contractId, status: { not: "libere" } },
      });
      if (remaining === 0) {
        await prisma.mission.update({ where: { id: operation.contract.missionId }, data: { status: "cloturee" } });
      }
    }
    return { ok: true };
  }

  // US-502 — comportement historique (contrat sans jalon) : la mission avance dans son cycle
  // seulement à la confirmation, jamais de façon optimiste à l'envoi de l'instruction.
  if (operation.instructionType === "hold") {
    await prisma.mission.update({
      where: { id: operation.contract.missionId },
      data: { status: "fonds_sous_sequestre" },
    });
  } else if (operation.instructionType === "release") {
    await prisma.mission.update({
      where: { id: operation.contract.missionId },
      data: { status: "validee" },
    });
  }

  return { ok: true };
}
