import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isFeatureEnabledForZone } from "@/lib/feature-flags";
import { canStartMission } from "@/lib/mission-risk-gate";
import { canHoldJalon } from "@/lib/jalons";

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

  const jalon = await prisma.jalon.findUnique({ where: { id: jalonId } });
  if (!jalon || jalon.contractId !== contract.id) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (!canHoldJalon(jalon.status)) {
    return NextResponse.json({ error: "jalon_not_holdable" }, { status: 409 });
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
  }

  const operation = await prisma.pspEscrowOperation.create({
    data: {
      contractId: contract.id,
      jalonId: jalon.id,
      pspName: process.env.PSP_NAME ?? "fedapay",
      pspReference: `hold_${randomUUID()}`,
      amount: jalon.montant,
      currency: contract.mission.currency,
      instructionType: "hold",
    },
  });

  return NextResponse.json({ id: operation.id, status: operation.status });
}
