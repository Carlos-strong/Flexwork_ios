import { NextResponse } from "next/server";
import { requireAnyAdminRole } from "@/lib/adminGuard";
import { loadPspExchange } from "@/lib/psp-journal";

// Conversation complète autour d'une référence PSP. La référence passe en paramètre de requête et
// non en segment d'URL : une référence reçue d'un tiers peut contenir n'importe quel caractère.
export async function GET(req: Request) {
  const guard = await requireAnyAdminRole(["superviseur", "mediation"]);
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const reference = new URL(req.url).searchParams.get("reference")?.trim();
  if (!reference) return NextResponse.json({ error: "reference_required" }, { status: 400 });

  const exchange = await loadPspExchange(reference);
  if (!exchange) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(exchange);
}
