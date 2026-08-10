import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/adminGuard";

// File d'attente des médiations ouvertes (Phase 6, US-601/602) — miroir de
// /api/admin/kyc/queue, manquant jusqu'ici : propose/respond existaient sans aucune liste
// pour les alimenter depuis le tableau de bord admin.
export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const mediations = await prisma.mediation.findMany({
    where: { outcome: "en_cours" },
    include: {
      contract: { select: { mission: { select: { id: true, titre: true } } } },
      openedBy: { select: { email: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    items: mediations.map((m) => ({
      id: m.id,
      reason: m.reason,
      proposedResolution: m.proposedResolution,
      createdAt: m.createdAt,
      openedBy: m.openedBy.email,
      mission: m.contract.mission,
    })),
  });
}
