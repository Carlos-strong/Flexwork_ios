import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { randomUUID } from "crypto";

const schema = z.object({ reason: z.string().min(5) });

// US-601 (Phase 6) : ouvre une médiation — gèle les fonds chez le PSP, ne tranche rien.
// Remplace intégralement l'ancien Litige à arbitrage opposable.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const contract = await prisma.prestationContract.findUnique({ where: { missionId }, include: { mission: true } });
  if (!contract || (contract.clientId !== userId && contract.providerId !== userId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const [mediation] = await prisma.$transaction([
    prisma.mediation.create({
      data: { contractId: contract.id, openedById: userId, reason: parsed.data.reason },
    }),
    prisma.mission.update({ where: { id: missionId }, data: { status: "mediation_ouverte" } }),
    prisma.pspEscrowOperation.create({
      data: {
        contractId: contract.id,
        pspName: process.env.PSP_NAME ?? "fedapay",
        pspReference: `freeze_${randomUUID()}`,
        amount: contract.mission.budget,
        currency: contract.mission.currency,
        instructionType: "freeze",
      },
    }),
  ]);

  return NextResponse.json(mediation);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id: missionId } = await params;

  const contract = await prisma.prestationContract.findUnique({ where: { missionId } });
  if (!contract) return NextResponse.json({ items: [] });

  const mediations = await prisma.mediation.findMany({
    where: { contractId: contract.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ items: mediations });
}
