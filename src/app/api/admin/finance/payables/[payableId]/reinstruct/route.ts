import { NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";
import { instructOwedPayable } from "@/lib/escrow";

// Réinstruction d'un versement dû (2026-09-15) — typiquement après un refus du PSP. La console
// signalait « versement refusé, à réinstruire » sans aucun geste pour le faire. Borné par le
// disponible du séquestre et idempotent sous verrou (voir instructOwedPayable). Réservé à la
// Médiation, justifié et journalisé, comme tout geste qui fait sortir des fonds.
export async function POST(req: Request, { params }: { params: Promise<{ payableId: string }> }) {
  const guard = await requireAdminRole("mediation");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { payableId } = await params;

  const body = await req.json().catch(() => null);
  const justification = typeof body?.justification === "string" ? body.justification.trim() : "";
  if (justification.length < 5) {
    return NextResponse.json({ error: "justification_required" }, { status: 400 });
  }

  const res = await instructOwedPayable(payableId);
  if (!res.ok) {
    return NextResponse.json(
      { error: res.reason, available: res.available },
      { status: res.reason === "not_found" ? 404 : 409 }
    );
  }

  await logAdminAction({
    adminId: guard.user.id,
    action: "escrow_payable_reinstruct",
    targetType: "PrestationContract",
    targetId: res.payable.contractId!,
    justification: `${justification} — ${res.operation.amount} ${res.operation.currency}`,
  });

  return NextResponse.json({ amount: res.operation.amount, currency: res.operation.currency, status: res.operation.status });
}
