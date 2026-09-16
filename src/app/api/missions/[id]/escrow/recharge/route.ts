import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { rechargeNeed, requestRecharge } from "@/lib/escrow-recharge";
import { isVirtualPspEnabled, shouldAutoConfirmStub } from "@/lib/psp-virtual";

// Recharge du séquestre (§13, Phase 3 — 2026-09-14) : le client complète le séquestre à hauteur
// de ce qu'il doit déjà, pour débloquer des paiements reconnus mais non transmis.
//
// Réservé au CLIENT : c'est lui qui finance. Le prestataire ne doit même pas pouvoir déclencher
// la demande — il verrait sinon un moyen de pression sur la trésorerie de son client.
//
// Le MONTANT n'est pas dans le corps de la requête, et c'est délibéré : il est dérivé de ce qui
// est réellement dû (`rechargeNeed`). Laisser le client choisir combien il recharge rouvrirait
// la possibilité d'un séquestre partiellement couvert, c'est-à-dire exactement l'état que la
// règle du §13 refuse.
async function loadOwnedContract(missionId: string, userId: string) {
  const contract = await prisma.prestationContract.findUnique({
    where: { missionId },
    select: { id: true, clientId: true },
  });
  // 404 et non 403 : un non-propriétaire n'apprend pas l'existence du contrat (règle R02).
  return contract && contract.clientId === userId ? contract : null;
}

// GET — ce qui manque, sans rien instruire. L'écran de séquestre l'affiche pour que le client
// sache ce qu'on lui demande AVANT de le lui demander.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const contract = await loadOwnedContract(missionId, userId);
  if (!contract) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const need = await rechargeNeed(contract.id);
  if (!need) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(need);
}

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const contract = await loadOwnedContract(missionId, userId);
  if (!contract) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const result = await requestRecharge(contract.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // PSP virtuelle en mode console : l'instruction reste `pending`, le client est redirigé vers
  // la page de paiement simulée — même traitement que le financement initial
  // (POST /api/missions/[id]/escrow/hold), pour que la recharge ne soit pas un parcours à part.
  const pspRedirect =
    isVirtualPspEnabled() && !shouldAutoConfirmStub() && result.operation.status === "pending"
      ? {
          reference: result.operation.pspReference,
          amount: result.operation.amount,
          currency: result.operation.currency,
        }
      : null;

  return NextResponse.json({
    id: result.operation.id,
    amount: result.amount,
    currency: result.operation.currency,
    status: result.operation.status,
    pspRedirect,
  });
}
