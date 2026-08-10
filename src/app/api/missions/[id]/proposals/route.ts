import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { proposalSchema } from "@/lib/validation";
import { requireVerifiedKyc } from "@/lib/kycGuard";
import { hasRequiredGarants } from "@/lib/garant-rules";

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
  if (mission.status !== "publiee") {
    return NextResponse.json({ error: "mission_not_open" }, { status: 409 });
  }

  // Candidature sur mission présentiel/hybride : garant obligatoire requis
  if (mission.mode !== "distance") {
    const garants = await prisma.garant.findMany({ where: { profile: { userId: providerId } } });
    if (!hasRequiredGarants(garants)) {
      return NextResponse.json({
        error: "garant_required",
        message: "Un garant obligatoire est requis pour candidater à une mission en présentiel ou hybride.",
      }, { status: 403 });
    }

    // Candidature sur mission présentiel/hybride à risque HIGH : le prestataire doit avoir
    // déclaré au moins une assurance RC Pro valide (non retirée par modération).
    if (mission.riskLevel === "high") {
      const insuranceCount = await prisma.professionalDeclaration.count({
        where: {
          profile: { userId: providerId },
          declarationType: "insurance",
          removedAt: null,
        },
      });
      if (insuranceCount === 0) {
        return NextResponse.json({
          error: "insurance_required",
          message: "Cette mission à risque élevé exige une assurance RC Pro déclarée. Veuillez en ajouter une dans votre profil avant de candidater.",
        }, { status: 403 });
      }
    }
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

  const proposals = await prisma.missionProposal.findMany({
    where: { missionId },
    include: { provider: { select: { id: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ items: proposals });
}
