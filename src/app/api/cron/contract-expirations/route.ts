import { NextResponse } from "next/server";
import { expireUnsignedContracts } from "@/lib/scheduled-tasks";

// Annulation temporelle des contrats dont le délai de contre-signature est dépassé : le
// prestataire a signé (1/2) mais le client n'a pas contre-signé (2/2) dans les 48h.
// Logique dans src/lib/scheduled-tasks.ts, partagée avec le worker (src/worker/index.ts) : cette
// route reste pour les déploiements qui planifient par cron système (Bearer CRON_SECRET).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(await expireUnsignedContracts());
}
