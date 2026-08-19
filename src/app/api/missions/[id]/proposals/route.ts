import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { proposalSchema } from "@/lib/validation";
import { requireVerifiedKyc } from "@/lib/kycGuard";
import { checkCandidatureEligibility } from "@/lib/candidature-guard";

// Phase 4 : un prestataire propose un prix sur une mission (remplace l'ancien devis).
// US-203 : bloqué tant que le KYC du prestataire n'est pas vérifié — l'autre des deux
// SEULES actions gatées par le KYC (l'autre étant la publication d'une mission).
// Règles de candidature (flowchart) :
//   - Mode distance → KYC vérifié uniquement (US-203, déjà en place)
//   - Mode présentiel/hybride → KYC + garant obligatoire + assurance si risque HIGH
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

  // Gardes de candidature partagés (mission ouverte, garant, assurance) — même source que
  // POST /api/missions/[id]/devis (src/lib/candidature-guard.ts).
  const eligibility = await checkCandidatureEligibility(mission, providerId);
  if (!eligibility.ok) {
    return NextResponse.json(
      { error: eligibility.error, message: eligibility.message },
      { status: eligibility.status }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = proposalSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload", details: parsed.error.flatten() }, { status: 400 });
  }

  const proposal = await prisma.missionProposal.upsert({
    where: { missionId_providerId: { missionId, providerId } },
    create: { missionId, providerId, montant: parsed.data.montant, message: parsed.data.message },
    update: { montant: parsed.data.montant, message: parsed.data.message },
  });

  return NextResponse.json(proposal);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const { id: missionId } = await params;

  const [proposals, mission] = await Promise.all([
    prisma.missionProposal.findMany({
      where: { missionId },
      include: {
        provider: { select: { id: true, email: true } },
        revisions: {
          include: { author: { select: { firstname: true, lastname: true } } },
          orderBy: { roundNumber: "asc" },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.mission.findUnique({
      where: { id: missionId },
      select: { budgetType: true, maxRevisionRounds: true },
    }),
  ]);

  return NextResponse.json({ items: proposals, mission });
}
