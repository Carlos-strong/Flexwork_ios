import type { Mediation } from "@prisma/client";
import { prisma } from "@/lib/db";
import { emitContractRefund, emitMediationRelease, emitUnfreeze, providerPayoutReady } from "@/lib/escrow";

// Exécution d'un accord de médiation (§24) — extraite de POST /api/admin/mediations/[id]/respond
// (2026-11-02) pour être rejouée à la vérification du compte de versement du prestataire
// (src/lib/payout-release.ts) : même code, que l'accord vienne d'être scellé ou qu'il attendait.
//
// Compte de versement non vérifié et une part à verser au prestataire : RIEN n'est exécuté. Les
// fonds restent gelés et la médiation ouverte, acceptations conservées. Exécuter le reste (dégel,
// remboursement, clôture) sans le versement rendrait disponible une somme que la médiation
// destine au prestataire — et que d'autres flux (reliquat, libérations) pourraient emporter.

export type MediationExecution =
  | { executed: true; mediation: Mediation; releasedAmount: number; refundedAmount: number }
  | { executed: false; reason: "payout_unverified" | "not_agreed" };

export async function executeMediationAgreement(mediationId: string): Promise<MediationExecution> {
  const mediation = await prisma.mediation.findUniqueOrThrow({
    where: { id: mediationId },
    include: { contract: { include: { mission: true } } },
  });
  if (mediation.outcome !== "en_cours" || !(mediation.clientAccepted && mediation.providerAccepted)) {
    return { executed: false, reason: "not_agreed" };
  }
  if ((mediation.resolutionAmount ?? 0) > 0 && !(await providerPayoutReady(mediation.contractId))) {
    return { executed: false, reason: "payout_unverified" };
  }
  const currency = mediation.contract.mission.currency;
  // Statut à restaurer : celui d'avant l'ouverture (voir la route de réponse).
  const restoredStatus = mediation.previousStatus ?? "fonds_sous_sequestre";

  // ── La répartition du §24 ───────────────────────────────────────────────────────────────
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
    await emitUnfreeze({ contractId: mediation.contractId, currency, amount: aDistribuer });
  }

  // Une résolution sans montant (différend non financier) n'instruit rien du tout.
  const operation = await emitMediationRelease({
    contractId: mediation.contractId,
    currency,
    requested: mediation.resolutionAmount ?? 0,
  });

  // Part rendue au CLIENT. Sans elle, une médiation qui lui donnait raison ne savait que
  // s'abstenir : elle pouvait payer le prestataire, jamais rembourser.
  const remboursement = mediation.refundAmount
    ? await emitContractRefund({ contractId: mediation.contractId, currency, requested: mediation.refundAmount })
    : null;

  const closed = await prisma.$transaction(async (tx) => {
    const m = await tx.mediation.update({
      where: { id: mediationId },
      data: { outcome: "agreement", closedAt: new Date() },
    });
    await tx.mission.update({ where: { id: mediation.contract.missionId }, data: { status: restoredStatus } });
    return m;
  });

  return {
    executed: true,
    mediation: closed,
    releasedAmount: operation?.amount ?? 0,
    refundedAmount: remboursement?.amount ?? 0,
  };
}
