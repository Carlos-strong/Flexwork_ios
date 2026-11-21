import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { holdCandidatureForKyc } from "@/lib/proposal-drafts";
import { devisSchema } from "@/lib/validation";
import { submitDevisAs } from "@/lib/candidature-submit";

// Soumission / révision d'un devis BTP par le prestataire (mission budgetType = "QUOTE").
// 1ère soumission → round 1, statut "en_negociation" ; chaque re-soumission incrémente le
// round. La proposition est créée au besoin (upsert) : candidater et soumettre un devis est
// une seule et même action pour une demande de devis. Les gardes KYC/garant/assurance sont
// partagées avec POST /api/missions/[id]/proposals (src/lib/candidature-guard.ts).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: missionId } = await params;
  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  const body = await req.json().catch(() => null);
  const parsed = devisSchema.safeParse(body);

  // KYC non vérifié : le devis est mis en brouillon, prêt à partir une fois l'identité
  // vérifiée (src/lib/proposal-drafts.ts).
  const hold = await holdCandidatureForKyc({
    kind: "devis",
    mission: mission && mission.budgetType === "QUOTE" ? mission : null,
    payload: parsed.success ? (body as Prisma.InputJsonValue) : null,
  });
  if (hold.held) return NextResponse.json(hold.body, { status: hold.status });
  if (hold.providerId === null) return NextResponse.json(hold.response.body, { status: hold.response.status });
  const providerId = hold.providerId;
  return submitDevisAs({ missionId, providerId, mission, body });
}
