import { NextResponse } from "next/server";
import { z } from "zod";
import { randomUUID } from "crypto";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

const schema = z.object({ accept: z.boolean() });

// US-603 (Phase 6) : le client et le prestataire acceptent ou refusent la résolution
// proposée. Accord des deux parties -> instruction PSP conforme. Refus -> fonds restent
// gelés, aucune transmission automatique.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id } = await params;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const mediation = await prisma.mediation.findUnique({ where: { id }, include: { contract: { include: { mission: true } } } });
  if (!mediation) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const isClient = mediation.contract.clientId === userId;
  const isProvider = mediation.contract.providerId === userId;
  if (!isClient && !isProvider) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!parsed.data.accept) {
    const updated = await prisma.mediation.update({
      where: { id },
      data: isClient ? { clientAccepted: false } : { providerAccepted: false },
    });
    return NextResponse.json(updated);
  }

  const updated = await prisma.mediation.update({
    where: { id },
    data: isClient ? { clientAccepted: true } : { providerAccepted: true },
  });

  if (updated.clientAccepted && updated.providerAccepted) {
    await prisma.$transaction([
      prisma.mediation.update({ where: { id }, data: { outcome: "agreement", closedAt: new Date() } }),
      prisma.pspEscrowOperation.create({
        data: {
          contractId: mediation.contractId,
          pspName: process.env.PSP_NAME ?? "fedapay",
          pspReference: `mediation_release_${randomUUID()}`,
          amount: mediation.contract.mission.budget,
          currency: mediation.contract.mission.currency,
          instructionType: "release",
        },
      }),
    ]);
  }

  return NextResponse.json(updated);
}
