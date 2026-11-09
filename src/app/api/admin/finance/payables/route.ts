import { NextResponse } from "next/server";
import { requireAnyAdminRole } from "@/lib/adminGuard";
import { listPayables } from "@/lib/admin-finance";

// Créances (Payable) de toute la plateforme — ce qui a été reconnu dû, et où en est son versement.
export async function GET(req: Request) {
  const guard = await requireAnyAdminRole(["superviseur", "mediation"]);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const url = new URL(req.url);
  return NextResponse.json(
    await listPayables({
      status: url.searchParams.get("status"),
      q: url.searchParams.get("q"),
      cursor: url.searchParams.get("cursor"),
    })
  );
}
