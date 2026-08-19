import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireVerifiedKyc } from "@/lib/kycGuard";
import { checkCandidatureEligibility } from "@/lib/candidature-guard";
import { devisSchema } from "@/lib/validation";
import {
  ACTIVE_NEGOCIATION_STATUSES,
  CLOSED_PROPOSAL_STATUSES,
  computeDevisData,
} from "@/lib/devis";

// Soumission / révision d'un devis BTP par le prestataire (mission budgetType = "QUOTE").
// 1ère soumission → round 1, statut "en_negociation" ; chaque re-soumission incrémente le
// round. La proposition est créée au besoin (upsert) : candidater et soumettre un devis est
// une seule et même action pour une demande de devis. Les gardes KYC/garant/assurance sont
// partagées avec POST /api/missions/[id]/proposals (src/lib/candidature-guard.ts).
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const guard = await requireVerifiedKyc();
  if (!guard.ok) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const providerId = guard.userId;
  const { id: missionId } = await params;

  const mission = await prisma.mission.findUnique({ where: { id: missionId } });
  if (!mission) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const eligibility = await checkCandidatureEligibility(mission, providerId);
  if (!eligibility.ok) {
    return NextResponse.json(
      { error: eligibility.error, message: eligibility.message },
      { status: eligibility.status }
    );
  }
  if (mission.budgetType !== "QUOTE") {
    return NextResponse.json({ error: "not_quote_mission" }, { status: 409 });
  }
  if (mission.dateExpiration && new Date(mission.dateExpiration) < new Date()) {
    return NextResponse.json({ error: "mission_expired" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  const parsed = devisSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const existing = await prisma.missionProposal.findUnique({
    where: { missionId_providerId: { missionId, providerId } },
  });
  if (existing && CLOSED_PROPOSAL_STATUSES.includes(existing.status)) {
    return NextResponse.json({ error: "proposal_closed" }, { status: 409 });
  }
  if (existing && existing.roundActuel >= mission.maxRevisionRounds) {
    return NextResponse.json({ error: "max_revisions_reached" }, { status: 409 });
  }

  // Exclusivité : une seule négociation active par prestataire (hors de cette mission).
  const activeCount = await prisma.missionProposal.count({
    where: {
      providerId,
      status: { in: [...ACTIVE_NEGOCIATION_STATUSES] },
      missionId: { not: missionId },
    },
  });
  if (activeCount > 0) {
    return NextResponse.json({ error: "active_negotiation_exists" }, { status: 409 });
  }

  const devis = computeDevisData(
    parsed.data.lineItems,
    parsed.data.delay,
    parsed.data.notes ?? "",
    parsed.data.tvaRate
  );
  const newRound = (existing?.roundActuel ?? 0) + 1;

  const updated = await prisma.$transaction(async (tx) => {
    const p = await tx.missionProposal.upsert({
      where: { missionId_providerId: { missionId, providerId } },
      create: {
        missionId,
        providerId,
        montant: devis.totalTTC,
        message: "Candidature en mode devis",
        status: "en_negociation",
        roundActuel: newRound,
        devisData: devis as Prisma.InputJsonValue,
      },
      update: {
        montant: devis.totalTTC,
        status: "en_negociation",
        roundActuel: newRound,
        devisData: devis as Prisma.InputJsonValue,
      },
    });
    await tx.devisRevision.create({
      data: {
        proposalId: p.id,
        roundNumber: newRound,
        authorId: providerId,
        devisData: devis as Prisma.InputJsonValue,
        comment: newRound === 1 ? "Première soumission du devis" : `Révision ${newRound}`,
      },
    });
    return p;
  });

  return NextResponse.json({ proposalId: updated.id, round: newRound, devis });
}
