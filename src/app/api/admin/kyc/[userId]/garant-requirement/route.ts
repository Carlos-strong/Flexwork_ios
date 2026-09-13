import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";
import { isChantierRole } from "@/lib/age-gate";

const schema = z.object({ garantRequired: z.boolean() });

// Active/désactive l'exigence de garant pour un prestataire, compte par compte (2026-09-09).
// Par défaut AUCUNE filière n'est soumise au garant (User.garantRequired = false) ; l'Admin
// KYC l'active quand il l'estime nécessaire. Quand elle est active, la candidature à une
// mission présentiel/hybride exige un garant obligatoire (candidature-guard.ts →
// hasRequiredGarants). L'option ne concerne que les filières chantier (artisan, manœuvre,
// expert_btp_autres — isChantierRole) : on refuse d'activer pour un autre rôle.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ userId: string }> }
) {
  const guard = await requireAdminRole("kyc");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { userId } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const target = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, role: true, garantRequired: true },
  });
  if (!target) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  // On ne peut activer l'exigence de garant que pour une filière chantier.
  if (parsed.data.garantRequired && !isChantierRole(target.role)) {
    return NextResponse.json(
      { error: "not_chantier_role", message: "L'exigence de garant ne concerne que les filières chantier (artisan, manœuvre, expert BTP)." },
      { status: 400 }
    );
  }

  const updated = await prisma.user.update({
    where: { id: userId },
    data: {
      garantRequired: parsed.data.garantRequired,
      garantRequiredSetById: parsed.data.garantRequired ? guard.user.id : null,
      garantRequiredSetAt: parsed.data.garantRequired ? new Date() : null,
    },
    select: { id: true, garantRequired: true, garantRequiredSetAt: true },
  });

  await logAdminAction({
    adminId: guard.user.id,
    action: "garant_requirement",
    targetType: "User",
    targetId: userId,
    justification: parsed.data.garantRequired
      ? `Exigence de garant ACTIVÉE pour ${target.email} (${target.role}).`
      : `Exigence de garant DÉSACTIVÉE pour ${target.email} (${target.role}).`,
  });

  return NextResponse.json(updated);
}
