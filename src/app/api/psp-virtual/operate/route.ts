import { NextResponse } from "next/server";
import { operateVirtualPsp, type VirtualPspAction } from "@/lib/psp-virtual";

// POST /api/psp-virtual/operate — action de la console PSP virtuelle (développement) :
// autoriser un HOLD (paiement Mobile Money), confirmer une RELEASE/FREEZE/REFUND, ou faire
// échouer une opération. La confirmation transite toujours par le chemin webhook signé
// (US-503) — voir operateVirtualPsp. Hors développement : 404.
const ACTIONS: VirtualPspAction[] = ["authorize", "release", "freeze", "refund", "fail"];

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as
    | { action?: unknown; pspReference?: unknown }
    | null;
  const action = body?.action;
  const pspReference = body?.pspReference;

  if (typeof action !== "string" || !ACTIONS.includes(action as VirtualPspAction)) {
    return NextResponse.json({ error: "invalid_action" }, { status: 400 });
  }
  if (typeof pspReference !== "string" || !pspReference) {
    return NextResponse.json({ error: "invalid_psp_reference" }, { status: 400 });
  }

  const result = await operateVirtualPsp(action as VirtualPspAction, pspReference);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json({ ok: true, event: result.event, pspReference });
}
