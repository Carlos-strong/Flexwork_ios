import { NextResponse } from "next/server";
import { receivePspWebhook } from "@/lib/psp/inbox";

// US-503 (Phase 5) : seule route capable de confirmer un mouvement d'escrow — signature
// HMAC vérifiée, aucune capture manuelle possible ailleurs dans l'application.
//
// Boîte de réception (2026-10-01, src/lib/psp/inbox.ts) : le corps est lu BRUT et consigné après
// vérification de la signature. En mode `worker` (QUEUE_MODE), la route répond dès la
// consignation et le worker applique ; en mode `inline`, elle applique dans la foulée et répond
// le résultat, comme avant. Les refus avant traitement (sans signature, charge illisible,
// signature fausse) restent consignés au journal.
export async function POST(req: Request) {
  const rawBody = await req.text();
  const { status, body } = await receivePspWebhook(rawBody, req.headers.get("x-webhook-signature"));
  return NextResponse.json(body, { status });
}
