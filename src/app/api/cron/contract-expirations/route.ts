import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { cancelExpiredContract, COUNTER_SIGN_DEADLINE_MS } from "@/lib/contract-expiry";

// Annulation temporelle des contrats dont le délai de contre-signature est dépassé : le
// prestataire a signé (1/2) mais le client n'a pas contre-signé (2/2) dans les 48h.
// Exécuter périodiquement (cron) — même pattern que /api/cron/devis-expirations.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - COUNTER_SIGN_DEADLINE_MS);
  const expired = await prisma.prestationContract.findMany({
    where: { providerSignedAt: { not: null, lt: cutoff }, clientSignedAt: null },
    select: { id: true },
  });

  let cancelled = 0;
  for (const c of expired) {
    if (await cancelExpiredContract(c.id)) cancelled++;
  }

  return NextResponse.json({ cancelled });
}
