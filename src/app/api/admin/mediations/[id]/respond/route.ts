import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { emitContractRefund, emitMediationRelease, emitUnfreeze } from "@/lib/escrow";

const schema = z.object({ accept: z.boolean() });

// US-603 (Phase 6) : le client et le prestataire acceptent ou refusent la résolution proposée.
//
// Trois correctifs par rapport à la version d'origine (2026-09-11) :
//
//  1. Le MONTANT. La route libérait `mission.budget` — le budget PUBLIÉ, alors que tout le
//     reste du domaine escrow calcule sur `contractPrice` (le prix réellement contracté) et
//     déduit ce qui est déjà parti. Sur une contre-proposition acceptée à un autre prix, ou sur
//     un contrat à jalons dont une partie est déjà payée, l'écart se transformait en
//     sur-paiement. La résolution porte désormais son propre montant (`resolutionAmount`, posé
//     par l'Admin Médiation), borné par ce qui reste effectivement séquestré.
//
//  2. La FIN. Un refus se contentait d'écrire `accepted: false` et s'arrêtait là : la médiation
//     restait `en_cours` pour toujours, et la mission bloquée en `mediation_ouverte` — statut
//     qu'aucune route ne quittait. Un refus clôt désormais la médiation sur `no_agreement`.
//
//  3. Le RETOUR. À la clôture, quel qu'en soit le sens, la mission retrouve le statut qu'elle
//     avait avant l'ouverture (`Mediation.previousStatus`) : le cycle de vie reprend là où il
//     s'était arrêté, au lieu de rester mort.
//
//  4. Le DÉGEL (2026-09-14). Cette route notait jusqu'ici qu'elle « ne dégèle pas les fonds au
//     PSP, le modèle n'ayant pas d'instruction inverse du `freeze` ». C'était une dette réelle :
//     la mission reprenait son cours à la clôture, mais le gel restait en vigueur, donc plus
//     aucune libération ne pouvait sortir du séquestre. L'instruction `unfreeze` existe
//     désormais (voir emitUnfreeze, src/lib/escrow.ts) et les DEUX chemins de clôture — accord
//     comme désaccord — la transmettent.
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  const userId = (session.user as typeof session.user & { id: string }).id;
  const { id } = await params;

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const mediation = await prisma.mediation.findUnique({
    where: { id },
    include: { contract: { include: { mission: true } } },
  });
  if (!mediation) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (mediation.outcome !== "en_cours") {
    return NextResponse.json({ error: "mediation_closed" }, { status: 409 });
  }

  const isClient = mediation.contract.clientId === userId;
  const isProvider = mediation.contract.providerId === userId;
  if (!isClient && !isProvider) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  // Statut à restaurer : celui d'avant l'ouverture. `fonds_sous_sequestre` en repli pour les
  // médiations ouvertes avant l'introduction du champ — jamais `mediation_ouverte`, qui
  // reconduirait le blocage que ce correctif supprime.
  const restoredStatus = mediation.previousStatus ?? "fonds_sous_sequestre";

  if (!parsed.data.accept) {
    const updated = await prisma.$transaction(async (tx) => {
      const m = await tx.mediation.update({
        where: { id },
        data: {
          ...(isClient ? { clientAccepted: false } : { providerAccepted: false }),
          outcome: "no_agreement",
          closedAt: new Date(),
        },
      });
      await tx.mission.update({
        where: { id: mediation.contract.missionId },
        data: { status: restoredStatus },
      });
      return m;
    });
    // Le litige se referme sans accord : les fonds redeviennent mobilisables. Sans ce dégel,
    // la mission reprenait son cours mais plus aucune libération ne pouvait sortir — le gel
    // restait en vigueur pour toujours et `available` restait à zéro.
    await emitUnfreeze({
      contractId: mediation.contractId,
      currency: mediation.contract.mission.currency,
    });
    return NextResponse.json(updated);
  }

  const updated = await prisma.mediation.update({
    where: { id },
    data: isClient ? { clientAccepted: true } : { providerAccepted: true },
  });

  // Une seule acceptation ne décide rien : on attend l'autre partie.
  if (!(updated.clientAccepted && updated.providerAccepted)) {
    return NextResponse.json(updated);
  }

  // ── Accord des deux parties : la répartition du §24 ─────────────────────────────────────
  //
  //     Libérer 30 000 · Rembourser 10 000 · Maintenir 20 000 bloqués
  //
  // Trois destinations, et non une. Le DÉGEL vient en premier, et seulement à hauteur de ce qui
  // est effectivement distribué : ce qui n'est ni libéré ni remboursé RESTE bloqué, ce qui est
  // exactement ce que « maintenir bloqué » veut dire. Dégeler tout puis redistribuer aurait
  // rendu disponible, l'espace d'un instant, une somme que la médiation venait de décider
  // d'immobiliser.
  //
  // L'ordre compte aussi pour une raison technique : les libérations sont bornées par le solde
  // DISPONIBLE (invariant n°4), et une somme gelée n'en fait pas partie. Distribuer avant de
  // dégeler ne libérerait rien.
  const aDistribuer = (mediation.resolutionAmount ?? 0) + (mediation.refundAmount ?? 0);
  if (aDistribuer > 0) {
    await emitUnfreeze({
      contractId: mediation.contractId,
      currency: mediation.contract.mission.currency,
      amount: aDistribuer,
    });
  }

  // Une résolution sans montant (différend non financier) n'instruit rien du tout.
  const operation = await emitMediationRelease({
    contractId: mediation.contractId,
    currency: mediation.contract.mission.currency,
    requested: mediation.resolutionAmount ?? 0,
  });

  // Part rendue au CLIENT. Sans elle, une médiation qui lui donnait raison ne savait que
  // s'abstenir : elle pouvait payer le prestataire, jamais rembourser.
  const remboursement = mediation.refundAmount
    ? await emitContractRefund({
        contractId: mediation.contractId,
        currency: mediation.contract.mission.currency,
        requested: mediation.refundAmount,
      })
    : null;

  const closed = await prisma.$transaction(async (tx) => {
    const m = await tx.mediation.update({
      where: { id },
      data: { outcome: "agreement", closedAt: new Date() },
    });
    await tx.mission.update({
      where: { id: mediation.contract.missionId },
      data: { status: restoredStatus },
    });
    return m;
  });

  return NextResponse.json({
    ...closed,
    releasedAmount: operation?.amount ?? 0,
    refundedAmount: remboursement?.amount ?? 0,
  });
}
