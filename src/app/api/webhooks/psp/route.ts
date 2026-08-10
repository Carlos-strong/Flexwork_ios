import { NextResponse } from "next/server";
import { applyPspWebhookEvent, type PspWebhookPayload } from "@/lib/psp-webhook";

// US-503 (Phase 5) : seule route capable de confirmer un mouvement d'escrow — signature
// HMAC vérifiée, aucune capture manuelle possible ailleurs dans l'application.
export async function POST(req: Request) {
  const signature = req.headers.get("x-webhook-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 401 });
  }

  const payload = (await req.json().catch(() => null)) as PspWebhookPayload | null;
  if (!payload?.pspReference || !payload?.event) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const result = await applyPspWebhookEvent(payload, signature);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({ received: true });
}
