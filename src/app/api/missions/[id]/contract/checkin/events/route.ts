import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { checkInEventSchema } from "@/lib/validation";
import { isCheckInToolActive, computeCheckInRetentionDate } from "@/lib/checkin-tool";

// A12 — le pointage est un outil ENTRE les parties, pas un système d'information de la
// plateforme : ces routes ne sont accessibles qu'au client et au prestataire du contrat
// concerné, jamais à un admin ni à aucune agrégation multi-contrats
// (etat-consolide-Flexwork.md §2, A12).
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
  const parsed = checkInEventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const contract = await prisma.prestationContract.findUnique({
    where: { missionId },
    include: { mission: true },
  });
  if (!contract || (contract.clientId !== userId && contract.providerId !== userId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!isCheckInToolActive(contract.clientOptedInCheckIn, contract.providerOptedInCheckIn)) {
    return NextResponse.json({ error: "checkin_tool_not_active" }, { status: 409 });
  }

  const missionDeadline = new Date(
    contract.mission.createdAt.getTime() + contract.mission.delaiJours * 24 * 60 * 60 * 1000
  );
  const event = await prisma.checkInEvent.create({
    data: {
      contractId: contract.id,
      partyId: userId,
      type: parsed.data.type,
      gpsLat: parsed.data.gpsLat,
      gpsLng: parsed.data.gpsLng,
      retainUntil: computeCheckInRetentionDate(missionDeadline),
    },
  });

  return NextResponse.json(event);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const contract = await prisma.prestationContract.findUnique({ where: { missionId } });
  if (!contract || (contract.clientId !== userId && contract.providerId !== userId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const events = await prisma.checkInEvent.findMany({
    where: { contractId: contract.id },
    orderBy: { occurredAt: "asc" },
  });

  return NextResponse.json({ items: events });
}
