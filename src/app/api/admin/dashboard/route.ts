import { NextResponse } from "next/server";
import type { AdminRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireAdmin } from "@/lib/adminGuard";
import { loadFinanceSnapshot } from "@/lib/admin-finance";
import { getAutomationBacklog } from "@/lib/automation-backlog";

export const dynamic = "force-dynamic";

/**
 * Indicateurs du Dashboard « Admin Métier », FILTRÉS PAR RÔLE.
 *
 * Le Dashboard de flexwork_job montre à tout administrateur le volume financier, les
 * utilisateurs et les missions. Ici chaque compteur est rattaché aux rôles qui ont le droit de
 * le lire, et n'est même pas calculé pour les autres : un chiffre qu'un rôle n'a pas à connaître
 * ne doit pas transiter vers son navigateur, masqué ou non.
 *
 * Les mêmes critères que les files de travail sont appliqués (KYC en attente, garants
 * `a_appeler`, médiations `en_cours`) : un compteur qui annonce 4 dossiers sur un écran qui
 * en liste 3 redevient un chiffre invérifiable.
 */
const READERS = {
  kyc: ["kyc", "superviseur"],
  moderation: ["moderation", "superviseur"],
  mediation: ["mediation", "superviseur"],
  superviseur: ["superviseur"],
} satisfies Record<string, AdminRole[]>;

export async function GET() {
  const guard = await requireAdmin();
  if ("error" in guard) return NextResponse.json({ error: guard.error }, { status: guard.status });
  const role = guard.user.adminRole;
  if (!role) return NextResponse.json({ error: "forbidden_wrong_admin_role" }, { status: 403 });

  const can = (group: keyof typeof READERS) => (READERS[group] as AdminRole[]).includes(role);

  const [kyc, moderation, mediation, supervision] = await Promise.all([
    can("kyc")
      ? Promise.all([
          prisma.user.count({ where: { kycStatus: "en_attente" } }),
          prisma.garant.count({ where: { statutAppel: "a_appeler" } }),
          prisma.user.count({ where: { kycStatus: "verifie" } }),
        ]).then(([pending, garantsToCall, verified]) => ({ pending, garantsToCall, verified }))
      : null,
    can("moderation")
      ? Promise.all([
          prisma.report.count({ where: { status: "ouvert" } }),
          prisma.user.count({ where: { status: "suspended" } }),
        ]).then(([reportsOpen, suspended]) => ({ reportsOpen, suspended }))
      : null,
    can("mediation")
      ? Promise.all([prisma.mediation.count({ where: { outcome: "en_cours" } }), loadFinanceSnapshot()]).then(([open, snap]) => ({
          open,
          held: snap.total.held,
          funded: snap.total.funded,
          released: snap.total.released,
          payablesToInstruct: snap.payables.validated?.count ?? 0,
          anomalies: snap.anomalies.length,
          criticalAnomalies: snap.anomalies.filter((a) => a.severity === "critical").length,
        }))
      : null,
    can("superviseur")
      ? Promise.all([
          prisma.user.count(),
          prisma.mission.count(),
          prisma.mission.count({ where: { status: { notIn: ["brouillon", "cloturee", "remboursee"] } } }),
          getAutomationBacklog(),
          prisma.adminAuditLog.count({ where: { createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } }),
        ]).then(([users, missions, activeMissions, backlog, adminActions24h]) => ({
          users,
          missions,
          activeMissions,
          backlog: backlog.reduce((s, t) => s + t.due, 0),
          adminActions24h,
        }))
      : null,
  ]);

  return NextResponse.json({ role, kyc, moderation, mediation, supervision });
}
