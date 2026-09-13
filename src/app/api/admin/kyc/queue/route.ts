import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/adminGuard";

// US-103 : file d'attente KYC triée par date de dépôt, pour revue admin.
export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const pendingUsers = await prisma.user.findMany({
    where: { kycStatus: "en_attente" },
    include: {
      kycDocuments: { orderBy: { createdAt: "asc" } },
    },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    items: pendingUsers.map((u) => ({
      userId: u.id,
      email: u.email,
      tel: u.tel,
      role: u.role,
      // « Garant requis » activé par l'Admin KYC (défaut OFF) — affiché dans les dashboards
      // admin pour activer/désactiver l'exigence de garant par compte (2026-09-09).
      garantRequired: u.garantRequired,
      // UserRole n'a pas de valeur "admin" (prisma/schema.prisma) — un compte admin garde
      // role="client" par défaut, ce qui affichait à tort "Client" pour ces comptes.
      isAdmin: u.isAdmin,
      adminRole: u.adminRole,
      createdAt: u.createdAt,
      documents: u.kycDocuments.map((d) => ({
        id: d.id,
        type: d.type,
        status: d.status,
        createdAt: d.createdAt,
      })),
    })),
  });
}
