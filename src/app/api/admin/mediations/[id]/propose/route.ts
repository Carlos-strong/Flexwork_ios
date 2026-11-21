import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { logAdminAction } from "@/lib/admin-audit";
import { escrowBalance } from "@/lib/escrow";

const schema = z.object({
  proposedResolution: z.string().min(5),
  justification: z.string().min(1),
  // Montant à libérer au prestataire si les deux parties acceptent. Facultatif : une résolution
  // peut être purement non financière (reprise du livrable, délai supplémentaire). Absent ou 0
  // = aucune libération, les fonds restent au séquestre.
  resolutionAmount: z.number().int().min(0).optional(),
  // Montant à RENDRE au client si les deux parties acceptent (§24 : libérer · rembourser ·
  // maintenir bloqué). Il manquait ici alors que POST .../respond savait déjà l'exécuter : la
  // branche de remboursement d'une médiation n'était atteignable par aucun geste.
  refundAmount: z.number().int().min(0).optional(),
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

  const existing = await prisma.mediation.findUnique({ where: { id }, select: { contractId: true, outcome: true } });
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing.outcome !== "en_cours") {
    return NextResponse.json({ error: "mediation_closed" }, { status: 409 });
  }

  // Une proposition ne peut pas répartir plus que ce qui reste au séquestre. L'exécution le
  // bornerait de toute façon ; le refuser dès la proposition évite de soumettre aux parties une
  // répartition qu'elles accepteraient et qui ne serait versée qu'en partie.
  const aRepartir = (parsed.data.resolutionAmount ?? 0) + (parsed.data.refundAmount ?? 0);
  if (aRepartir > 0) {
    const { held } = await escrowBalance(existing.contractId);
    if (aRepartir > held) {
      return NextResponse.json({ error: "amount_exceeds_escrow", held }, { status: 400 });
    }
  }

  const mediation = await prisma.mediation.update({
    where: { id },
    data: {
      proposedResolution: parsed.data.proposedResolution,
      resolutionAmount: parsed.data.resolutionAmount ?? null,
      refundAmount: parsed.data.refundAmount ?? null,
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
