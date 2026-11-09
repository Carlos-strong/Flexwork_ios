import { NextResponse } from "next/server";
import { requireAnyAdminRole } from "@/lib/adminGuard";
import { listOperations } from "@/lib/admin-finance";

// Registre des instructions PSP, tous domaines confondus — filtrable par type, statut, portée et
// recherche libre (référence PSP, identifiant, titre de mission). Pagination par curseur.
export async function GET(req: Request) {
  const guard = await requireAnyAdminRole(["superviseur", "mediation"]);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const url = new URL(req.url);
  return NextResponse.json(
    await listOperations({
      type: url.searchParams.get("type"),
      status: url.searchParams.get("status"),
      source: url.searchParams.get("source"),
      q: url.searchParams.get("q"),
      cursor: url.searchParams.get("cursor"),
    })
  );
}
