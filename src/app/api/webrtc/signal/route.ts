// POST /api/webrtc/signal — envoie un signal WebRTC (offer/answer/ICE/hangup)
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { z } from "zod";
import { sendToUser } from "@/lib/webrtc/signaling";
import type { SignalType } from "@/lib/webrtc/types";

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

  sendToUser(parsed.data.to, {
    type: parsed.data.type as SignalType,
    from: userId,
    to: parsed.data.to,
    payload: parsed.data.payload,
    timestamp: Date.now(),
  });

  return NextResponse.json({ ok: true });
}
