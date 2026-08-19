// GET /api/webrtc/events — SSE stream pour recevoir les signaux WebRTC et notifications
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { addSSEClient, removeSSEClient } from "@/lib/webrtc/signaling";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as { id: string }).id;

  const stream = new ReadableStream({
    start(controller) {
      addSSEClient(userId, controller);
      // Envoi d'un ping initial pour confirmer la connexion
      controller.enqueue(new TextEncoder().encode(`data: {"type":"connected","userId":"${userId}"}\n\n`));
    },
    cancel(controller) {
      removeSSEClient(userId, controller);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
