import { NextResponse } from "next/server";
import { requireAnyAdminRole } from "@/lib/adminGuard";
import { loadFinanceSnapshot } from "@/lib/admin-finance";

// Console financière — instantané du registre (totaux, flux, anomalies, lignes par contrat).
// Lecture seule, ouverte au Superviseur et à la Médiation (voir src/lib/admin-finance.ts).
export async function GET() {
  const guard = await requireAnyAdminRole(["superviseur", "mediation"]);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  return NextResponse.json({ ...(await loadFinanceSnapshot()), viewerRole: guard.user.adminRole });
}
