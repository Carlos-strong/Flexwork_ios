import { NextResponse } from "next/server";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";
import { runResidualRefundSweep } from "@/lib/residual-refund";

// Déclenchement MANUEL du balayage des reliquats (§22) — le même que le cron quotidien, pour ne
// pas laisser un opérateur attendre le lendemain devant un reliquat qu'il vient de repérer.
// Idempotent par le solde : repasser ne rembourse pas deux fois. Réservé à la Médiation, comme
// tout geste qui fait sortir des fonds du séquestre, et journalisé avec son résultat.
export async function POST(req: Request) {
  const guard = await requireAdminRole("mediation");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const body = await req.json().catch(() => null);
  const justification = typeof body?.justification === "string" ? body.justification.trim() : "";
  if (justification.length < 5) {
    return NextResponse.json({ error: "justification_required" }, { status: 400 });
  }

  const report = await runResidualRefundSweep();
  await logAdminAction({
    adminId: guard.user.id,
    action: "escrow_residual_sweep",
    targetType: "Platform",
    targetId: "residual-refunds",
    justification: `${justification} — ${report.refunded} remboursement(s), ${report.amount} XOF`,
  });
  return NextResponse.json(report);
}
