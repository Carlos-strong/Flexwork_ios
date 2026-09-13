import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { refundExpiredOrder, PROVIDER_SIGN_DEADLINE_MS } from "@/lib/gig-expiry";

// Annulation + remboursement automatique des commandes Gig dont le délai de signature du
// prestataire (24h après la signature du client) est dépassé. Exécuter périodiquement
// (cron) — même pattern que /api/cron/contract-expirations (Bearer CRON_SECRET).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - PROVIDER_SIGN_DEADLINE_MS);
  const expired = await prisma.gigOrder.findMany({
    where: {
      clientSignedAt: { not: null, lt: cutoff },
      providerSignedAt: null,
      status: "client_signed",
    },
    select: { id: true },
  });

  let refunded = 0;
  for (const o of expired) {
    if (await refundExpiredOrder(o.id)) refunded++;
  }

  return NextResponse.json({ refunded });
}
