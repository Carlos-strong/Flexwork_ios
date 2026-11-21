import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

/**
 * Exports CSV du Reporting — superviseur uniquement.
 *
 * Minimisation : les exports portent des IDENTIFIANTS, pas d'adresses e-mail ni de numéros de
 * téléphone de clients ou de prestataires. Le superviseur lit tout à l'écran (§13) ; un fichier,
 * lui, sort de la plateforme et se transmet — il n'emporte que ce qu'il faut pour être recoupé.
 * Seul le journal d'audit nomme des personnes : les administrateurs, dont l'attribution des
 * gestes est précisément l'objet du journal.
 *
 * Chaque export est lui-même journalisé : extraire des données en masse est un geste.
 */
const DATASETS = {
  missions: {
    label: "missions",
    async build() {
      const rows = await prisma.mission.findMany({
        orderBy: { createdAt: "desc" },
        select: { id: true, titre: true, domaine: true, status: true, budget: true, currency: true, createdAt: true, clientId: true },
      });
      return toCsv(
        ["id", "titre", "domaine", "statut", "budget", "devise", "cree_le", "client_id"],
        rows.map((m) => [m.id, m.titre, m.domaine, m.status, m.budget, m.currency, m.createdAt, m.clientId]),
      );
    },
  },
  contrats: {
    label: "contrats",
    async build() {
      const rows = await prisma.prestationContract.findMany({
        orderBy: { createdAt: "desc" },
        select: { id: true, missionId: true, clientId: true, providerId: true, financingMode: true, retentionRate: true, clientSignedAt: true, providerSignedAt: true, createdAt: true },
      });
      return toCsv(
        ["id", "mission_id", "client_id", "prestataire_id", "financement", "taux_retenue", "signe_client_le", "signe_prestataire_le", "cree_le"],
        rows.map((c) => [c.id, c.missionId, c.clientId, c.providerId, c.financingMode, c.retentionRate, c.clientSignedAt, c.providerSignedAt, c.createdAt]),
      );
    },
  },
  signalements: {
    label: "signalements",
    async build() {
      const rows = await prisma.report.findMany({
        orderBy: { createdAt: "desc" },
        select: { id: true, targetType: true, targetId: true, reason: true, status: true, createdAt: true, handledAt: true, decisionNote: true },
      });
      return toCsv(
        ["id", "cible", "cible_id", "motif", "statut", "recu_le", "decide_le", "motif_decision"],
        rows.map((r) => [r.id, r.targetType, r.targetId, r.reason, r.status, r.createdAt, r.handledAt, r.decisionNote]),
      );
    },
  },
  audit: {
    label: "journal-audit",
    async build() {
      const rows = await prisma.adminAuditLog.findMany({
        orderBy: { createdAt: "desc" },
        take: 10_000,
        select: { createdAt: true, action: true, targetType: true, targetId: true, justification: true, admin: { select: { email: true, adminRole: true } } },
      });
      return toCsv(
        ["date", "administrateur", "role", "action", "cible", "cible_id", "justification"],
        rows.map((r) => [r.createdAt, r.admin.email, r.admin.adminRole, r.action, r.targetType, r.targetId, r.justification]),
      );
    },
  },
} as const;

type Dataset = keyof typeof DATASETS;

export async function GET(req: Request, { params }: { params: Promise<{ dataset: string }> }) {
  const guard = await requireAdminRole("superviseur");
  if ("error" in guard) return Response.json({ error: guard.error }, { status: guard.status });

  const { dataset } = await params;
  if (!(dataset in DATASETS)) return Response.json({ error: "unknown_dataset" }, { status: 404 });

  const spec = DATASETS[dataset as Dataset];
  const csv = await spec.build();

  await logAdminAction({
    adminId: guard.user.id,
    action: "report_export",
    targetType: "Export",
    targetId: dataset,
    justification: `Export CSV « ${spec.label} »`,
  });

  const stamp = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="flexwork-${spec.label}-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
