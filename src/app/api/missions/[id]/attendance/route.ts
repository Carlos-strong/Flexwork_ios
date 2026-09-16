import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { escrowBalance } from "@/lib/escrow";
import { attendanceAmount, fundingAlert } from "@/lib/spot-time";
import { submitAttendance } from "@/lib/spot-time-actions";

// Relevés de présence d'un contrat au temps (§20). Lisibles par les TROIS parties concernées —
// le prestataire qui pointe, le client qui paie, le responsable de chantier qui constate — et
// par elles seules. Un tiers reçoit 404, indistinguable d'une mission inexistante (règle R02).
async function loadContract(missionId: string, userId: string) {
  const contract = await prisma.prestationContract.findUnique({
    where: { missionId },
    include: { mission: { select: { currency: true, status: true } }, spotTimeTerms: true },
  });
  if (!contract) return null;
  const autorise =
    contract.clientId === userId ||
    contract.providerId === userId ||
    contract.spotTimeTerms?.siteManagerId === userId;
  return autorise ? contract : null;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const contract = await loadContract(missionId, userId);
  if (!contract) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const terms = contract.spotTimeTerms;
  if (!terms) return NextResponse.json({ error: "not_a_time_contract" }, { status: 409 });

  const [releves, balance] = await Promise.all([
    prisma.attendance.findMany({
      where: { contractId: contract.id },
      orderBy: { periodStart: "desc" },
      select: {
        id: true,
        periodStart: true,
        periodEnd: true,
        declaredQuantity: true,
        approvedQuantity: true,
        overtimeQuantity: true,
        status: true,
        rejectionReason: true,
        validatedAt: true,
      },
    }),
    escrowBalance(contract.id),
  ]);

  const pures = {
    rateUnit: terms.rateUnit,
    rate: terms.rate,
    maxQuantity: terms.maxQuantity,
    maxAmount: terms.maxAmount,
    overtimeAllowed: terms.overtimeAllowed,
    overtimeRate: terms.overtimeRate,
  };
  const cumulQuantite = releves
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + (r.approvedQuantity ?? 0), 0);

  return NextResponse.json({
    currency: contract.mission.currency,
    // Le rôle décide de ce que l'interface propose : déclarer, ou valider. Jamais les deux.
    role:
      contract.providerId === userId
        ? "worker"
        : contract.clientId === userId
          ? "client"
          : "site_manager",
    terms: pures,
    // Chantier clos (ou suspendu par une médiation) : plus aucune déclaration ni clôture à
    // proposer. L'interface le lit ici plutôt que de redéduire l'état depuis le statut.
    closed: ["cloturee", "remboursee"].includes(contract.mission.status),
    suspended: contract.mission.status === "mediation_ouverte",
    consumedQuantity: cumulQuantite,
    remainingQuantity: Math.max(0, terms.maxQuantity - cumulQuantite),
    // Alerte du §19 : prévenir AVANT que le chantier ne bute sur un refus.
    funding: fundingAlert(pures, balance.available),
    available: balance.available,
    items: releves.map((r) => ({
      ...r,
      // Montant déjà reconnu pour un relevé validé ; ce qu'il VAUDRAIT pour les autres.
      amount:
        r.status === "approved"
          ? attendanceAmount(pures, r.approvedQuantity ?? 0, r.overtimeQuantity)
          : attendanceAmount(pures, r.declaredQuantity),
    })),
  });
}

// POST — le PRESTATAIRE déclare une présence. Purement déclaratif : rien n'est calculé, rien
// n'est dû, rien n'est versé (§9). C'est la validation qui fait naître la créance.
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const contract = await loadContract(missionId, userId);
  if (!contract) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Seul le travailleur déclare sa propre présence — ni le client, ni le responsable de
  // chantier ne pointent à sa place. Ils constatent, ils ne déclarent pas.
  if (contract.providerId !== userId) {
    return NextResponse.json({ error: "worker_only" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const periodStart = body?.periodStart ? new Date(body.periodStart) : null;
  const periodEnd = body?.periodEnd ? new Date(body.periodEnd) : null;
  const declaredQuantity = typeof body?.declaredQuantity === "number" ? body.declaredQuantity : NaN;
  if (!periodStart || !periodEnd || Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) {
    return NextResponse.json({ error: "invalid_period" }, { status: 400 });
  }

  const res = await submitAttendance({
    contractId: contract.id,
    workerId: userId,
    periodStart,
    periodEnd,
    declaredQuantity,
  });
  if (!res.ok) {
    return NextResponse.json({ error: res.error }, { status: res.error === "not_found" ? 404 : 409 });
  }
  return NextResponse.json({ id: res.attendanceId }, { status: 201 });
}

