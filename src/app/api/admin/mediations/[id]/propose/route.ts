import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";

const schema = z.object({
  proposedResolution: z.string().min(5),
  justification: z.string().min(1),
  // Montant à libérer au prestataire si les deux parties acceptent. Facultatif : une résolution
  // peut être purement non financière (reprise du livrable, délai supplémentaire). Absent ou 0
  // = aucune libération, les fonds restent au séquestre.
  resolutionAmount: z.number().min(0).optional(),
});

// US-602 (Phase 6) : l'Admin Médiation propose une résolution — ne tranche jamais
// unilatéralement. Aucune transmission PSP directe depuis cette route (voir accept).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireAdminRole("mediation");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const mediation = await prisma.mediation.update({
    where: { id },
    data: {
      proposedResolution: parsed.data.proposedResolution,
      resolutionAmount: parsed.data.resolutionAmount ?? null,
      mediatorAdminId: guard.user.id,
    },
  });

  await logAdminAction({
    adminId: guard.user.id,
    action: "mediation_resolution_proposed",
    targetType: "Mediation",
    targetId: id,
    justification: parsed.data.justification,
  });

  return NextResponse.json(mediation);
}
