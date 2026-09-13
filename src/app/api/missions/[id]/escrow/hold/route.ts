import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { requestContractHold } from "@/lib/escrow";
import { isVirtualPspEnabled, shouldAutoConfirmStub } from "@/lib/psp-virtual";

// US-501 (Phase 5) : transmet une instruction HOLD au PSP — la plateforme ne détient jamais
// les fonds, elle enregistre l'instruction et attend la confirmation par webhook (US-503).
// Prérequis bloquant : contrat PSP signé + validation juridique (etat-consolide-Flexwork.md
// §5) — développée derrière un flag, jamais activée en production sans confirmation.
// Depuis 2026-08-30, la logique (garde-fous + montant = prix du contrat, pas le budget
// publié) est partagée avec le déclenchement automatique post-contre-signature via
// src/lib/escrow.ts::requestContractHold. Seule l'autorisation (client propriétaire) est ici.
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

  const contract = await prisma.prestationContract.findUnique({
    where: { missionId },
    select: { id: true, clientId: true },
  });
  if (!contract || contract.clientId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const result = await requestContractHold(contract.id);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }

  // PSP virtuelle en mode console : l'instruction est créée `pending` — on redirige le client
  // vers la page de paiement Mobile Money simulée pour l'autoriser (webhook signé ensuite).
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
    status: result.operation.status,
    pspRedirect,
  });
}
