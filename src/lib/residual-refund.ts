import { prisma } from "@/lib/db";
import { emitContractRefund, escrowBalancesFor } from "@/lib/escrow";
import { notifyMissionParties } from "@/lib/mission-notify";

// Remboursement du reliquat en fin de contrat (§22 du cahier des charges — 2026-09-14).
//
//     FIN DE CONTRAT → Solde séquestre → Remboursement client
//     « Il ne doit jamais rester un argent fantôme dans la mission. »
//
// Le chemin de remboursement existait depuis 0.3, mais il fallait un administrateur pour le
// déclencher. Personne ne surveillant les soldes un par un, un reliquat pouvait dormir
// indéfiniment sur une mission close — ce que le §22 interdit en une phrase.
//
// ── D'où viennent les reliquats ────────────────────────────────────────────────────────────
// Ils ne sont pas exceptionnels, et c'est ce qui rend ce balayage nécessaire :
//   - un contrat au TEMPS finance un plafond (20 jours) et en consomme rarement la totalité ;
//   - une médiation peut ne redistribuer qu'une partie du séquestre ;
//   - une journée de présence écartée après contestation libère des fonds que personne ne
//     réclame plus ;
//   - un arrondi, un jalon annulé après financement.
//
// ── Ce que ce balayage ne fait PAS ─────────────────────────────────────────────────────────
// Il ne décide jamais qu'une mission est terminée. Il n'agit que sur celles qui le sont DÉJÀ —
// `cloturee` ou `remboursee` — et laisse `mediation_ouverte` intacte : rendre au client des fonds
// pendant qu'un litige les dispute reviendrait à trancher ce litige en silence.

// Statuts où plus aucune libération n'est attendue. `remboursee` y figure pour la reprise : un
// remboursement partiel antérieur a pu laisser un solde, et rien ne viendrait le chercher.
const TERMINAL_STATUSES = ["cloturee", "remboursee"] as const;

export type ResidualRefundReport = {
  examined: number;
  refunded: number;
  amount: number;
  skipped: { missionId: string; reason: string }[];
};

/**
 * Contrats de missions terminées dont le séquestre garde un solde (2026-10-01).
 *
 * Le balayage chargeait TOUS les contrats de missions closes puis calculait leurs soldes : un
 * coût proportionnel à l'historique de la plateforme, pour une poignée de reliquats. Ce filtre
 * calcule en base le solde détenu (règle `netHeldAmount` : HOLD confirmé crédite, toute sortie
 * non refusée débite, gel et dégel ne déplacent rien) et ne retient que les contrats où il
 * reste quelque chose. Le disponible exact — gel et retenue déduits — est ensuite relu par
 * `escrowBalancesFor` sur ces seuls contrats.
 */
export async function findContractsWithResidual(limit = 5000): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c.id
      FROM "PrestationContract" c
      JOIN "Mission" m ON m.id = c."missionId"
      JOIN "PspEscrowOperation" o ON o."contractId" = c.id AND o.status <> 'failed'
     WHERE m.status IN ('cloturee', 'remboursee')
     GROUP BY c.id
    HAVING SUM(CASE
                 WHEN o."instructionType" = 'hold' AND o.status = 'confirmed' THEN o.amount
                 WHEN o."instructionType" IN ('release', 'retention_release', 'refund') THEN -o.amount
                 ELSE 0
               END) > 0.005
     LIMIT ${limit}`;
  return rows.map((r) => r.id);
}

export type ResidualOutcome = { missionId: string; refunded: number } | { missionId: string; skipped: string };

/**
 * Rembourse le reliquat d'UN contrat — l'unité de travail du worker, et le corps du balayage.
 *
 * Idempotent par le solde, comme `emitContractRefund` : un contrat déjà soldé n'a plus rien à
 * rendre et n'instruit rien. Le statut terminal est relu ici : entre la sélection et le
 * traitement, une mission a pu rouvrir une médiation.
 */
export async function refundResidualForContract(contractId: string): Promise<ResidualOutcome | null> {
  const contract = await prisma.prestationContract.findUnique({
    where: { id: contractId },
    select: {
      id: true,
      missionId: true,
      clientId: true,
      providerId: true,
      mission: { select: { currency: true, titre: true, status: true } },
    },
  });
  if (!contract) return null;
  if (!(TERMINAL_STATUSES as readonly string[]).includes(contract.mission.status)) {
    return { missionId: contract.missionId, skipped: "not_terminal" };
  }

  // `available` et non `held` : ce qui est gelé par un litige, ou retenu en garantie, n'est pas
  // un reliquat oublié — c'est une somme qui attend encore quelque chose.
  const balance = (await escrowBalancesFor([contract.id])).get(contract.id);
  if (!balance || balance.available <= 0) return { missionId: contract.missionId, skipped: "nothing_to_refund" };

  const operation = await emitContractRefund({ contractId: contract.id, currency: contract.mission.currency });
  if (!operation) return { missionId: contract.missionId, skipped: "nothing_to_refund" };

  // Les deux parties sont prévenues : le client parce que l'argent lui revient, le prestataire
  // parce qu'un mouvement sur le séquestre de SA mission ne doit pas lui être invisible.
  const montant = `${operation.amount.toLocaleString("fr-FR")} ${contract.mission.currency}`;
  await notifyMissionParties({
    missionId: contract.missionId,
    type: "escrow_residual_refunded",
    actor: {
      userId: contract.clientId,
      message: `Reliquat du séquestre remboursé — ${montant} vous sont rendus sur « ${contract.mission.titre} ».`,
      email: {
        subject: `Remboursement du séquestre — ${contract.mission.titre}`,
        text: `La mission « ${contract.mission.titre} » est terminée et son séquestre présentait un solde. ${montant} vous sont remboursés.`,
      },
    },
    counterpart: {
      userId: contract.providerId,
      message: `Le reliquat non dû du séquestre de « ${contract.mission.titre} » (${montant}) a été rendu au client.`,
    },
  });
  return { missionId: contract.missionId, refunded: operation.amount };
}

/**
 * Rembourse au client le reliquat séquestré de toute mission terminée (route cron). Le worker,
 * lui, répartit `findContractsWithResidual` en un job par contrat.
 */
export async function runResidualRefundSweep(): Promise<ResidualRefundReport> {
  const contractIds = await findContractsWithResidual();
  const report: ResidualRefundReport = { examined: contractIds.length, refunded: 0, amount: 0, skipped: [] };
  for (const contractId of contractIds) {
    try {
      const outcome = await refundResidualForContract(contractId);
      if (!outcome) continue;
      if ("refunded" in outcome) {
        report.refunded++;
        report.amount += outcome.refunded;
      } else {
        report.skipped.push({ missionId: outcome.missionId, reason: outcome.skipped });
      }
    } catch (error) {
      console.error("[residual-refund] échec", contractId, error);
      report.skipped.push({ missionId: contractId, reason: "error" });
    }
  }
  return report;
}

/**
 * Mesure à blanc du balayage des reliquats : combien de missions closes gardent un solde
 * disponible au séquestre, et pour quel montant. Même sélection et même critère (`available`)
 * que `runResidualRefundSweep`, sans rien rembourser — pour l'écran « Queues ».
 */
export async function countResidualRefundsDue(): Promise<{ examined: number; due: number; amount: number }> {
  const examined = await prisma.prestationContract.count({
    where: { mission: { status: { in: [...TERMINAL_STATUSES] } } },
  });
  const withBalance = await findContractsWithResidual();
  if (withBalance.length === 0) return { examined, due: 0, amount: 0 };

  const soldes = await escrowBalancesFor(withBalance);
  let due = 0;
  let amount = 0;
  for (const id of withBalance) {
    const available = soldes.get(id)?.available ?? 0;
    if (available > 0) {
      due++;
      amount += available;
    }
  }
  return { examined, due, amount };
}
