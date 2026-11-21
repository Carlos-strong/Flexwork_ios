import { NextResponse } from "next/server";
import { expireDevisNegotiations } from "@/lib/scheduled-tasks";

// Clôture des annonces arrivées à leur date limite de candidature (closeExpiredAnnonces, 2026-11-10).
// Logique dans src/lib/scheduled-tasks.ts, partagée avec le worker (src/worker/index.ts) : cette
// route reste pour les déploiements qui planifient par cron système (Bearer CRON_SECRET).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await expireDevisNegotiations());
}
