import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { canDecideJalon } from "@/lib/jalons";

// Version scopée-jalon de POST /api/missions/[id]/escrow/release (US-504) — le client valide
// le livrable d'UN jalon ("Vérifier" dans principeclient.md), ce qui transmet une instruction
// RELEASE pour le montant de CE jalon uniquement. Statut `valide` en attendant la confirmation
// webhook du PSP (jamais de libération optimiste, même règle que le reste de la Phase 5).
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

  const [operation] = await prisma.$transaction([
    prisma.pspEscrowOperation.create({
      data: {
        contractId: contract.id,
        jalonId: jalon.id,
        pspName: process.env.PSP_NAME ?? "fedapay",
        pspReference: `release_${randomUUID()}`,
        amount: jalon.montant,
        currency: contract.mission.currency,
        instructionType: "release",
      },
    }),
    prisma.jalon.update({ where: { id: jalonId }, data: { status: "valide" } }),
  ]);

  return NextResponse.json({ id: operation.id, status: operation.status });
}
