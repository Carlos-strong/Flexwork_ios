import { NextResponse } from "next/server";
import { requireAnyAdminRole } from "@/lib/adminGuard";
import { loadContractFinanceDetail } from "@/lib/admin-finance";

// Fiche financière d'un contrat : soldes, contrôle des règles d'or, anomalies, registre complet,
// créances, jalons, médiations, journal des gestes admin, et gestes réellement disponibles.
export async function GET(_req: Request, { params }: { params: Promise<{ contractId: string }> }) {
  const guard = await requireAnyAdminRole(["superviseur", "mediation"]);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { contractId } = await params;
  const detail = await loadContractFinanceDetail(contractId);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ...detail, viewerRole: guard.user.adminRole });
}
