import { NextResponse } from "next/server";
import { applyPspWebhookEvent, recordPspEvent, type PspWebhookPayload } from "@/lib/psp-webhook";

// US-503 (Phase 5) : seule route capable de confirmer un mouvement d'escrow — signature
// HMAC vérifiée, aucune capture manuelle possible ailleurs dans l'application.
//
// Journal (2026-09-15) : les appels refusés AVANT le traitement — sans signature, ou dont la
// charge est illisible — sont consignés eux aussi. Ce sont les plus suspects, et c'étaient les
// seuls à ne laisser aucune trace.
export async function POST(req: Request) {
  const startedAt = Date.now();
  const signature = req.headers.get("x-webhook-signature");
  const payload = (await req.json().catch(() => null)) as PspWebhookPayload | null;

  if (!signature) {
    await recordPspEvent({
      channel: "webhook",
      payload: payload ?? {},
      signatureValid: false,
      durationMs: Date.now() - startedAt,
      outcome: "rejected",
      error: "missing_signature",
    });
    return NextResponse.json({ error: "missing_signature" }, { status: 401 });
  }

  if (!payload?.pspReference || !payload?.event) {
    await recordPspEvent({
      channel: "webhook",
      payload: payload ?? {},
      signatureValid: false,
      durationMs: Date.now() - startedAt,
      outcome: "rejected",
      error: "invalid_payload",
    });
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const result = await applyPspWebhookEvent(payload, signature, "webhook");
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 409 });
  }

  return NextResponse.json({ received: true });
}
