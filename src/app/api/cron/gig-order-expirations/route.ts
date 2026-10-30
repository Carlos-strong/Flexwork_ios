import { NextResponse } from "next/server";
import { expireGigOrders } from "@/lib/scheduled-tasks";

// Annulation + remboursement automatique des commandes Gig dont le délai de signature du
// prestataire (24h après la signature du client) est dépassé.
// Logique dans src/lib/scheduled-tasks.ts, partagée avec le worker (src/worker/index.ts) : cette
// route reste pour les déploiements qui planifient par cron système (Bearer CRON_SECRET).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await expireGigOrders());
}
