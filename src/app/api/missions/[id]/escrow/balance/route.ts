import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { escrowBalance } from "@/lib/escrow";
import { escrowFinancialState } from "@/lib/escrow-state";
import { buildPayableLabeler } from "@/lib/payable-labels";

// Compte financier du séquestre d'une mission (2026-09-14) — les huit chiffres qui distinguent
// « financer » de « payer ».
//
// Jusqu'ici, `escrowBalance` n'était lu que par le module de recharge : la règle était appliquée
// par le moteur, mais invisible. Une règle qu'on ne peut pas constater n'est appliquée qu'à
// moitié — ni le client ni le prestataire ne pouvaient vérifier que leur argent la suit.
//
// ── Lisible par les DEUX parties ───────────────────────────────────────────────────────────
// Le séquestre est leur compte commun, pas celui du client. Le prestataire a besoin de voir ce
// qui lui est reconnu dû (`releasable`) et pas encore versé — c'est exactement l'information que
// « validé ≠ payé » rend nécessaire, et la lui cacher rendrait la distinction inéquitable : elle
// ne protégerait que celui qui paie. Un tiers reçoit 404, indistinguable d'une mission
// inexistante (règle R02).
//
// Lecture SEULE, et sans exception : aucune route n'expose une opération qui modifierait
// directement un solde (§21 du cahier des charges). Les soldes sont dérivés des instructions,
// jamais écrits.
//
// ── Les créances, dans la même réponse (2026-09-15) ────────────────────────────────────────
// Le modèle `Payable` existait sans qu'aucun écran ne le montre : on voyait un total « reconnu
// dû », jamais de quoi il était fait. La liste accompagne désormais les soldes — une seule
// requête pour le panneau, et deux vues qui ne peuvent pas se contredire puisqu'elles sont lues
// ensemble.
const PAYABLES_SHOWN = 50;

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id: missionId } = await params;

  const contract = await prisma.prestationContract.findFirst({
    where: { missionId, OR: [{ clientId: userId }, { providerId: userId }] },
    select: { id: true, clientId: true, mission: { select: { currency: true, status: true, titre: true } } },
  });
  if (!contract) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [balance, payables] = await Promise.all([
    escrowBalance(contract.id),
    prisma.payable.findMany({
      where: { contractId: contract.id },
      orderBy: { validatedAt: "desc" },
      take: PAYABLES_SHOWN,
      select: {
        id: true,
        sourceType: true,
        sourceId: true,
        amount: true,
        status: true,
        validatedAt: true,
        paidAt: true,
        escrowOperation: { select: { pspReference: true } },
      },
    }),
  ]);
  const label = await buildPayableLabeler(payables);

  return NextResponse.json({
    currency: contract.mission.currency,
    missionStatus: contract.mission.status,
    // État financier DÉRIVÉ des soldes, jamais stocké (voir src/lib/escrow-state.ts) : il ne
    // peut donc pas contredire les mouvements qui le fondent.
    financialState: escrowFinancialState(balance, contract.mission.status),
    // Le rôle permet à l'UI de formuler les mêmes chiffres du bon point de vue : `releasable`
    // se lit « à vous verser » côté prestataire et « à verser » côté client.
    role: contract.clientId === userId ? "client" : "provider",
    ...balance,
    payables: payables.map((p) => ({
      id: p.id,
      label: label(p, contract.mission.titre),
      sourceType: p.sourceType,
      amount: p.amount,
      status: p.status,
      validatedAt: p.validatedAt,
      paidAt: p.paidAt,
      reference: p.escrowOperation?.pspReference ?? null,
    })),
  });
}
