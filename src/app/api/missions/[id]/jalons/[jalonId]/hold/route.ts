import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isFeatureEnabledForZone } from "@/lib/feature-flags";
import { contractPrice, hasInFlightHold } from "@/lib/escrow";
import { canStartMission, coversAmount } from "@/lib/mission-risk-gate";
import { canHoldJalonSequential, firstBlockingSequentialJalon, isJalonUnengaged } from "@/lib/jalons";
import {
  autoConfirmPending,
  isVirtualPspEnabled,
  shouldAutoConfirmStub,
  virtualPspName,
} from "@/lib/psp-virtual";

// Version scopée-jalon de POST /api/missions/[id]/escrow/hold (US-501) — même garde-fous
// (contrat signé des deux côtés, flag PSP par zone, assurance effective si risque élevé),
// mais transmet une instruction HOLD portant sur le montant du jalon, pas du contrat entier.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; jalonId: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId, jalonId } = await params;

  const contract = await prisma.prestationContract.findUnique({
    where: { missionId },
    include: { client: true, mission: true },
  });
  if (!contract || contract.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!contract.clientSignedAt || !contract.providerSignedAt) {
    return NextResponse.json({ error: "contract_not_signed" }, { status: 409 });
  }

  // UNE seule lecture des jalons du contrat : la règle séquentielle a de toute façon besoin de
  // la fratrie entière, et le jalon ciblé en fait partie. Le filtre sur `contractId` fait aussi
  // office de contrôle d'appartenance — un jalonId d'un autre contrat n'est simplement pas dans
  // la liste, donc 404, sans requête dédiée.
  const jalons = await prisma.jalon.findMany({
    where: { contractId: contract.id },
    select: { id: true, ordre: true, status: true, montant: true },
  });
  const jalon = jalons.find((j) => j.id === jalonId);
  if (!jalon) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Jalons séquentiels (règle 18.8/18.9) : sans effet si contract.jalonsSequential est faux
  // (canHoldJalonSequential retombe alors sur canHoldJalon seul, comportement historique).
  if (!canHoldJalonSequential(jalon.status, jalon.ordre, jalons, contract.jalonsSequential)) {
    if (!isJalonUnengaged(jalon.status)) {
      return NextResponse.json({ error: "jalon_not_holdable" }, { status: 409 });
    }
    const blockedBy = firstBlockingSequentialJalon(jalon.ordre, jalons);
    return NextResponse.json({ error: "jalon_locked", blockedByOrdre: blockedBy?.ordre ?? null }, { status: 409 });
  }

  // Garde anti-doublon (règle 18.1) : la variante contrat l'avait depuis 2026-09-10, pas
  // celle-ci. Le statut du jalon reste `en_attente` tant que le webhook n'a pas confirmé, si
  // bien qu'un double-clic passait `isJalonUnengaged` deux fois et transmettait DEUX débits
  // Mobile Money pour le même jalon — sans aucune route pour annuler le second. Un HOLD
  // `failed` n'est pas compté : un paiement refusé doit pouvoir être réessayé.
  if (await hasInFlightHold({ jalonId: jalon.id })) {
    return NextResponse.json({ error: "hold_already_requested" }, { status: 409 });
  }

  const enabled = await isFeatureEnabledForZone("psp_montage_valide", contract.client.country ?? "BJ");
  if (!enabled) {
    return NextResponse.json({ error: "psp_not_enabled" }, { status: 403 });
  }

  if (contract.mission.riskLevel === "high") {
    const activeInsurance = await prisma.missionInsurance.findUnique({ where: { missionId } });
    const hasCoverage = activeInsurance?.status === "active" && activeInsurance.coverageEnd > new Date();
    if (!canStartMission(contract.mission.riskLevel, hasCoverage)) {
      return NextResponse.json({ error: "effective_insurance_required" }, { status: 403 });
    }
    // Plafond comparé au PRIX DU CONTRAT, pas au montant de ce jalon : l'exposition assurée ne
    // diminue pas parce que le client paie en plusieurs fois.
    if (!coversAmount(activeInsurance!.coverageCeiling, contractPrice(contract))) {
      return NextResponse.json({ error: "insurance_ceiling_too_low" }, { status: 403 });
    }
  }

  const operation = await prisma.pspEscrowOperation.create({
    data: {
      contractId: contract.id,
      jalonId: jalon.id,
      pspName: virtualPspName(),
      pspReference: `hold_${randomUUID()}`,
      amount: jalon.montant,
      currency: contract.mission.currency,
      instructionType: "hold",
    },
  });

  // PSP virtuelle : autoconfirm (stub) → confirmation webhook immédiate ; sinon `pending` et
  // redirection vers la page de paiement Mobile Money simulée.
  let status = operation.status;
  if (isVirtualPspEnabled() && shouldAutoConfirmStub()) {
    const confirmed = await autoConfirmPending(operation.pspReference!);
    if (confirmed.ok) {
      const refreshed = await prisma.pspEscrowOperation.findUnique({
        where: { id: operation.id },
        select: { status: true },
      });
      if (refreshed) status = refreshed.status;
    }
  }
  const pspRedirect =
    isVirtualPspEnabled() && !shouldAutoConfirmStub() && status === "pending"
      ? { reference: operation.pspReference, amount: jalon.montant, currency: contract.mission.currency }
      : null;

  return NextResponse.json({ id: operation.id, status, pspRedirect });
}
