import { prisma } from "@/lib/db";

// US-801 (Phase 8) — journalise toute action admin avec justification obligatoire non vide.
// Helper partagé, réutilisé par toutes les routes admin plutôt qu'une journalisation ad hoc
// dupliquée par route.
export async function logAdminAction(params: {
  adminId: string;
  action: string;
  targetType: string;
  targetId: string;
  justification: string;
}) {
  if (!params.justification.trim()) {
    throw new Error("admin_action_requires_justification");
  }

  return prisma.adminAuditLog.create({
    data: {
      adminId: params.adminId,
      action: params.action,
      targetType: params.targetType,
      targetId: params.targetId,
      justification: params.justification,
    },
  });
}

// US-202 — garde-fou anti-cadence-suspecte : max 30 validations KYC par admin par heure
// glissante.
const KYC_MAX_PER_HOUR = 30;

export async function isUnderKycRateLimit(adminId: string): Promise<boolean> {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const count = await prisma.adminAuditLog.count({
    where: { adminId, action: "kyc_decision", createdAt: { gte: oneHourAgo } },
  });
  return count < KYC_MAX_PER_HOUR;
}
