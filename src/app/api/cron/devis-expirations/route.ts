import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

// Annulation temporelle des négociations de devis expirées (mode QUOTE).
// Basé sur la date d'expiration de la mission, PAS sur le compteur de rounds : le dernier
// round doit rester utilisable (le client peut valider au dernier round).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const expired = await prisma.missionProposal.findMany({
    where: {
      status: { in: ["preselectionnee", "en_negociation"] },
      mission: { dateExpiration: { lt: new Date() } },
    },
    select: { id: true },
  });

  if (expired.length > 0) {
    await prisma.missionProposal.updateMany({
      where: { id: { in: expired.map((p) => p.id) } },
      data: { status: "annulee_definitive" },
    });
  }

  return NextResponse.json({ cancelled: expired.length });
}
