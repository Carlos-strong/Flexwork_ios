import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireAdminRole } from "@/lib/adminGuard";
import { emitContractRefund, escrowBalance } from "@/lib/escrow";
import { logAdminAction } from "@/lib/admin-audit";

// Remboursement au CLIENT du reliquat séquestré d'une mission qui n'ira pas à son terme
// (2026-09-14, cahier des charges §18 « ne jamais laisser un solde orphelin »).
//
// Pendant symétrique de POST /api/admin/contracts/[contractId]/retention/settle : celle-ci
// solde vers le PRESTATAIRE ce qu'une retenue a immobilisé, celle-là rend au CLIENT ce que
// personne ne réclamera plus. Les deux répondent au même mode de défaillance — une issue du
// séquestre qui n'était pas câblée — et sont réservées au même rôle, pour la même raison.
//
// Pourquoi l'admin médiation et pas le client : décider qu'une mission ne produira plus aucune
// libération est un arbitrage, pas une opération de gestion. Un client qui pourrait se
// rembourser seul disposerait d'un moyen de pression direct sur un prestataire en cours de
// travail — il retirerait les fonds au moment exact où le livrable arrive. Le séquestre ne
// protège les deux parties que si aucune n'en tient seule la sortie.
//
// GET renvoie ce qui serait remboursé, sans rien instruire : l'admin doit pouvoir regarder
// avant d'agir sur un montant qu'il ne peut pas reprendre.
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ contractId: string }> }
) {
  const guard = await requireAdminRole("mediation");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { contractId } = await params;

  const contract = await prisma.prestationContract.findUnique({
    where: { id: contractId },
    select: { id: true, mission: { select: { id: true, status: true, currency: true } } },
  });
  if (!contract) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Le DISPONIBLE, et non le détenu : c'est la borne qu'applique `emitContractRefund` (le gelé et
  // le retenu ne se remboursent pas). Annoncer le détenu promettait plus que ce qui serait rendu.
  return NextResponse.json({
    refundable: (await escrowBalance(contract.id)).available,
    currency: contract.mission.currency,
    missionStatus: contract.mission.status,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ contractId: string }> }
) {
  const guard = await requireAdminRole("mediation");
  if ("error" in guard) {
    return NextResponse.json({ error: guard.error }, { status: guard.status });
  }
  const { contractId } = await params;

  const contract = await prisma.prestationContract.findUnique({
    where: { id: contractId },
    select: { id: true, mission: { select: { id: true, currency: true } } },
  });
  if (!contract) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Montant optionnel : omis, tout le reliquat part. Un montant explicite permet un
  // remboursement PARTIEL — le cas d'une médiation qui rend une part au client et laisse le
  // reste libérable au prestataire. Il n'est pas vérifié ici contre le solde : `emitContractRefund`
  // le borne SOUS VERROU, seul endroit où la comparaison vaut quelque chose.
  const body = await req.json().catch(() => null);
  const requested = typeof body?.amount === "number" ? body.amount : undefined;
  if (requested !== undefined && !(Number.isFinite(requested) && requested > 0)) {
    return NextResponse.json({ error: "invalid_amount" }, { status: 400 });
  }
  // Justification obligatoire (2026-09-15) : faire sortir des fonds du séquestre est un
  // arbitrage, et tout arbitrage admin est journalisé (US-801). Ce geste ne l'était pas.
  const justification = typeof body?.justification === "string" ? body.justification.trim() : "";
  if (justification.length < 5) {
    return NextResponse.json({ error: "justification_required" }, { status: 400 });
  }

  const operation = await emitContractRefund({
    contractId: contract.id,
    currency: contract.mission.currency,
    requested,
  });

  // Aucun reliquat : rien à rendre. 409 et non 200 — l'admin a demandé une action qui n'a pas
  // eu lieu, le lui dire silencieusement l'inviterait à réessayer.
  if (!operation) {
    return NextResponse.json({ error: "nothing_to_refund" }, { status: 409 });
  }

  await logAdminAction({
    adminId: guard.user.id,
    action: "escrow_contract_refund",
    targetType: "PrestationContract",
    targetId: contract.id,
    justification: `${justification} — ${operation.amount} ${operation.currency}`,
  });

  return NextResponse.json({
    amount: operation.amount,
    currency: operation.currency,
    status: operation.status,
  });
}
