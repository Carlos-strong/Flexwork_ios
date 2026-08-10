import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";

// US-803 (Phase 8) : l'Admin Superviseur lit tout, ne modifie rien. Échantillonnage
// aléatoire de 5% des actions du mois pour la revue mensuelle (modele-skillafrica-v3-
// Flexwork.md §13).
export async function GET() {
  const guard = await requireAdminRole("superviseur");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const logs = await prisma.adminAuditLog.findMany({
    where: { createdAt: { gte: startOfMonth } },
    orderBy: { createdAt: "desc" },
    include: { admin: { select: { email: true } } },
  });

  const sampleSize = Math.max(1, Math.ceil(logs.length * 0.05));
  const shuffled = [...logs].sort(() => Math.random() - 0.5);
  const sample = shuffled.slice(0, sampleSize);

  return NextResponse.json({ total: logs.length, sample });
}
