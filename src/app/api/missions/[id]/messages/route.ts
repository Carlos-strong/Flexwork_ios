import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { containsLeakageAttempt } from "@/lib/leakage-detection";

const schema = z.object({ content: z.string().min(1).max(2000) });

// US-405 : chat par mission (polling côté client, pas d'infra websocket en local).
// US-1301 : bloque à l'envoi tout message contenant un numéro de téléphone ou une mention
// de paiement direct, pour prévenir la fuite hors plateforme.
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

  const mission = await prisma.mission.findUnique({ where: { id: missionId }, include: { proposals: true } });
  if (!mission) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const isParticipant =
    mission.clientId === userId || mission.proposals.some((p) => p.providerId === userId);
  if (!isParticipant) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  if (containsLeakageAttempt(parsed.data.content)) {
    return NextResponse.json(
      { error: "message_blocked_leakage_attempt" },
      { status: 422 }
    );
  }

  const message = await prisma.message.create({
    data: { missionId, senderId: userId, content: parsed.data.content },
  });

  return NextResponse.json({ id: message.id, createdAt: message.createdAt });
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

  const mission = await prisma.mission.findUnique({ where: { id: missionId }, include: { proposals: true } });
  if (!mission) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const isParticipant =
    mission.clientId === userId || mission.proposals.some((p) => p.providerId === userId);
  if (!isParticipant) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const messages = await prisma.message.findMany({
    where: { missionId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ items: messages });
}
