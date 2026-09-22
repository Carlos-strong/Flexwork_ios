import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";

export const dynamic = "force-dynamic";

/**
 * Qui détient quel pouvoir — lecture réservée au superviseur.
 *
 * Aucune route n'ATTRIBUE un rôle, et c'est volontaire : un administrateur qui peut s'octroyer
 * un pouvoir supprime la séparation que ces pouvoirs instituent (§13). Les rôles s'attribuent en
 * base, hors de l'application. L'écran « Rôles & Accès » de flexwork_job laisse entendre qu'on
 * les gère depuis l'interface ; celui-ci dit qui les détient, et où ils se changent.
 */
export async function GET() {
  const guard = await requireAdminRole("superviseur");
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const admins = await prisma.user.findMany({
    where: { isAdmin: true },
    orderBy: [{ adminRole: "asc" }, { email: "asc" }],
    select: { id: true, email: true, adminRole: true, status: true, createdAt: true },
  });

  // Dernière action journalisée de chaque administrateur : un pouvoir détenu et jamais exercé
  // est une information utile au contrôle, au même titre qu'un pouvoir exercé.
  const last = await prisma.adminAuditLog.groupBy({
    by: ["adminId"],
    where: { adminId: { in: admins.map((a) => a.id) } },
    _max: { createdAt: true },
    _count: { _all: true },
  });
  const byAdmin = new Map(last.map((l) => [l.adminId, { lastActionAt: l._max.createdAt, actions: l._count._all }]));

  return NextResponse.json({
    admins: admins.map((a) => ({
      ...a,
      lastActionAt: byAdmin.get(a.id)?.lastActionAt ?? null,
      actions: byAdmin.get(a.id)?.actions ?? 0,
    })),
  });
}
