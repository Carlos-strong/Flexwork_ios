import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isFeatureEnabledForZone } from "@/lib/feature-flags";
import { canStartMission } from "@/lib/mission-risk-gate";

// US-501 (Phase 5) : transmet une instruction HOLD au PSP — la plateforme ne détient jamais
// les fonds, elle enregistre l'instruction et attend la confirmation par webhook (US-503).
// Prérequis bloquant : contrat PSP signé + validation juridique (etat-consolide-Flexwork.md
// §5) — développée derrière un flag, jamais activée en production sans confirmation.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const contract = await prisma.prestationContract.findUnique({
    where: { missionId },
    include: { client: true, mission: true, jalons: { select: { id: true } } },
  });
  if (!contract || contract.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!contract.clientSignedAt || !contract.providerSignedAt) {
    return NextResponse.json({ error: "contract_not_signed" }, { status: 409 });
  }
  // Paiement fractionné (2026-08-06) : ce contrat a des jalons, chacun se finance
  // individuellement via POST /api/missions/[id]/jalons/[jalonId]/hold.
  if (contract.jalons.length > 0) {
    return NextResponse.json({ error: "use_jalon_hold" }, { status: 409 });
  }

  const enabled = await isFeatureEnabledForZone("psp_montage_valide", contract.client.country ?? "BJ");
  if (!enabled) {
    return NextResponse.json({ error: "psp_not_enabled" }, { status: 403 });
  }

  const existing = await prisma.pspEscrowOperation.findFirst({
    where: { contractId: contract.id, instructionType: "hold" },
  });
  if (existing) {
    return NextResponse.json({ error: "hold_already_requested" }, { status: 409 });
  }

  if (contract.mission.riskLevel === "high") {
    const activeInsurance = await prisma.missionInsurance.findUnique({ where: { missionId } });
    const hasCoverage = activeInsurance?.status === "active" && activeInsurance.coverageEnd > new Date();
    if (!canStartMission(contract.mission.riskLevel, hasCoverage)) {
      return NextResponse.json({ error: "effective_insurance_required" }, { status: 403 });
    }
  }

  const operation = await prisma.pspEscrowOperation.create({
    data: {
      contractId: contract.id,
      pspName: process.env.PSP_NAME ?? "fedapay",
      pspReference: `hold_${randomUUID()}`,
      amount: contract.mission.budget,
      currency: contract.mission.currency,
      instructionType: "hold",
    },
  });

  return NextResponse.json({ id: operation.id, status: operation.status });
}
