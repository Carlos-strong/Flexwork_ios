import { auth } from "@/auth";
import { subscribe } from "@/lib/realtime/hub";

// Flux Server-Sent Events de l'utilisateur connecté (2026-10-01) — voir src/lib/realtime/hub.ts.
//
// Le flux ne porte que des SIGNAUX (« tes notifications ont changé ») : le navigateur relit
// ensuite ses compteurs par les routes habituelles, avec leurs contrôles d'accès habituels.
//
// Derrière nginx : `proxy_buffering off` sur cette route (l'en-tête X-Accel-Buffering ci-dessous
// le demande aussi) et un `proxy_read_timeout` supérieur au battement de 25 s.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEARTBEAT_MS = 25_000;

export async function GET(req: Request) {
  const session = await auth();
  const userId = (session?.user as { id?: string } | undefined)?.id;
  if (!userId) return new Response("unauthenticated", { status: 401 });

  const encoder = new TextEncoder();
  let cleanup = () => {};

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };

      const unsubscribe = await subscribe(userId, (event) => {
        send(`event: refresh\ndata: ${JSON.stringify(event)}\n\n`);
      });
      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

      cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // déjà fermé par le client
        }
      };
      req.signal.addEventListener("abort", () => cleanup());

      // `retry` : délai de reconnexion du navigateur. `ready` : le client resynchronise ses
      // compteurs à chaque (re)connexion — ce qui a pu être manqué pendant la coupure est rattrapé.
      send(`retry: 5000\nevent: ready\ndata: {}\n\n`);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
