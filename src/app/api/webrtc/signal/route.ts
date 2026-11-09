// POST /api/webrtc/signal — envoie un signal WebRTC (offer/answer/ICE/hangup)
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { sendToUser } from "@/lib/webrtc/signaling";
import type { SignalType } from "@/lib/webrtc/types";
import { prisma } from "@/lib/db";

const schema = z.object({
  to: z.string().min(1),
  type: z.enum(["offer", "answer", "ice-candidate", "hangup"]),
  payload: z.unknown(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });

  // F-03 : ne relayer un signal visio que si une mission lie réellement l'émetteur au
  // destinataire (client↔candidat, dans un sens ou dans l'autre). Sans ce lien, on peut
  // faire sonner n'importe quel utilisateur connecté à volonté, découvrir sa présence en
  // ligne et l'exposer à des sollicitations hors de tout cadre contractuel. Ici le 403 est
  // justifié plutôt que le 404 : l'existence du destinataire n'est pas un secret, c'est la
  // relation qui est refusée (règle R02).
  const linked = await prisma.mission.findFirst({
    where: {
      OR: [
        { clientId: userId, proposals: { some: { providerId: parsed.data.to } } },
        { clientId: parsed.data.to, proposals: { some: { providerId: userId } } },
      ],
    },
    select: { id: true },
  });
  if (!linked) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  sendToUser(parsed.data.to, {
    type: parsed.data.type as SignalType,
    from: userId,
    to: parsed.data.to,
    payload: parsed.data.payload,
    timestamp: Date.now(),
  });

  return NextResponse.json({ ok: true });
}
