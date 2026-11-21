import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { escrowBalancesFor } from "@/lib/escrow";
import { escrowFinancialState } from "@/lib/escrow-state";

// Rubrique « Paiements » du client (2026-09-15) — jusqu'ici un écran vide qui promettait que
// « les paiements liés à tes missions apparaîtront ici » sans que rien ne les y fasse apparaître.
//
// Une ligne par contrat : ce que le client a engagé, versé, ce qui lui reste au séquestre, et
// surtout ce qui attend une action de sa part (un complément de financement). Mêmes chiffres que
// le panneau du séquestre de chaque mission — même fonction de calcul, en un nombre constant de
// requêtes (escrowBalancesFor), quel que soit le nombre de missions.
const CONTRACTS_SHOWN = 50;

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  const userId = (session.user as typeof session.user & { id: string }).id;

  const contracts = await prisma.prestationContract.findMany({
    where: { clientId: userId, clientSignedAt: { not: null } },
    orderBy: { createdAt: "desc" },
    take: CONTRACTS_SHOWN,
    select: {
      id: true,
      missionId: true,
      spotTimeTerms: { select: { id: true } },
      mission: { select: { titre: true, status: true, currency: true } },
    },
  });
  const balances = await escrowBalancesFor(contracts.map((c) => c.id));

  const items = contracts.map((c) => {
    const b = balances.get(c.id)!;
    return {
      missionId: c.missionId,
      titre: c.mission.titre,
      missionStatus: c.mission.status,
      currency: c.mission.currency,
      isTimeContract: !!c.spotTimeTerms,
      financialState: escrowFinancialState(b, c.mission.status),
      contractual: b.contractual,
      funded: b.funded,
      released: b.released,
      refunded: b.refunded,
      held: b.held,
      owedToProvider: b.owedToProvider,
      // Reconnu dû au-delà de ce que le séquestre couvre : le seul chiffre qui appelle un geste.
      missing: Math.max(0, b.releasable - b.available),
      fundingPending: b.fundingPending,
    };
  });

  const totals = items.reduce(
    (t, i) => ({
      funded: t.funded + i.funded,
      released: t.released + i.released,
      refunded: t.refunded + i.refunded,
      held: t.held + i.held,
      missing: t.missing + i.missing,
    }),
    { funded: 0, released: 0, refunded: 0, held: 0, missing: 0 }
  );

  return NextResponse.json({ items, totals });
}
