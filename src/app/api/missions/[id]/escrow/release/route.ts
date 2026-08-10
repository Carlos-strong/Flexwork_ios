import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

// US-504 (Phase 5) : le client valide le livrable, ce qui déclenche une instruction
// RELEASE — la confirmation reste conditionnée au webhook PSP (US-503), jamais optimiste.
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
    include: { mission: true, escrowOperations: true, jalons: { select: { id: true } } },
  });
  if (!contract || contract.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // Paiement fractionné (2026-08-06) : validation/libération jalon par jalon via
  // POST /api/missions/[id]/jalons/[jalonId]/validate.
  if (contract.jalons.length > 0) {
    return NextResponse.json({ error: "use_jalon_validate" }, { status: 409 });
  }

  const holdConfirmed = contract.escrowOperations.some(
    (op) => op.instructionType === "hold" && op.status === "confirmed"
  );
  if (!holdConfirmed) {
    return NextResponse.json({ error: "funds_not_held" }, { status: 409 });
  }
  if (contract.mission.status !== "livrable_soumis") {
    return NextResponse.json({ error: "no_deliverable_submitted" }, { status: 409 });
  }

  const operation = await prisma.pspEscrowOperation.create({
    data: {
      contractId: contract.id,
      pspName: process.env.PSP_NAME ?? "fedapay",
      pspReference: `release_${randomUUID()}`,
      amount: contract.mission.budget,
      currency: contract.mission.currency,
      instructionType: "release",
    },
  });

  return NextResponse.json({ id: operation.id, status: operation.status });
}
