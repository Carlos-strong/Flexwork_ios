import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { isFeatureEnabledForZone } from "@/lib/feature-flags";

// US-703 (Phase 7) : assurance à la mission, prime prélevée dans le même paiement.
// `[À VÉRIFIER]` (modele-skillafrica-v3-Flexwork.md §7.3) : existence du produit sur le
// marché béninois + statut de distribution — flag `mission_insurance_enabled`, jamais
// activé sans confirmation des deux prérequis.
const PREMIUM_RATE = 0.02;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const mission = await prisma.mission.findUnique({ where: { id: missionId }, include: { client: true } });
  if (!mission || mission.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (mission.riskLevel !== "high") {
    return NextResponse.json({ error: "insurance_not_applicable" }, { status: 409 });
  }

  const enabled = await isFeatureEnabledForZone("mission_insurance_enabled", mission.client.country ?? "BJ");
  if (!enabled) {
    return NextResponse.json({ error: "mission_insurance_not_enabled" }, { status: 403 });
  }

  const premiumAmount = Math.round(mission.budget * PREMIUM_RATE);
  const coverageStart = new Date();
  const coverageEnd = new Date(coverageStart.getTime() + mission.delaiJours * 24 * 60 * 60 * 1000);

  const insurance = await prisma.missionInsurance.create({
    data: {
      missionId,
      insurerName: process.env.MISSION_INSURER_NAME ?? "assureur-partenaire",
      premiumAmount,
      coverageCeiling: mission.budget,
      coverageStart,
      coverageEnd,
    },
  });

  return NextResponse.json(insurance);
}
