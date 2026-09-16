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
 * Rembourse au client le reliquat séquestré de toute mission terminée.
 *
 * Idempotent par le solde, comme `emitContractRefund` : une mission déjà soldée n'a plus rien à
 * rendre et n'instruit rien. Repasser deux fois de suite ne rembourse pas deux fois.
 */
export async function runResidualRefundSweep(): Promise<ResidualRefundReport> {
  const contracts = await prisma.prestationContract.findMany({
    where: { mission: { status: { in: [...TERMINAL_STATUSES] } } },
    select: {
      id: true,
      missionId: true,
      clientId: true,
      providerId: true,
      mission: { select: { currency: true, titre: true } },
    },
  });

  const report: ResidualRefundReport = {
    examined: contracts.length,
    refunded: 0,
    amount: 0,
    skipped: [],
  };
  if (contracts.length === 0) return report;

  // Tous les soldes en un nombre constant de requêtes — ce balayage passe sur l'intégralité des
  // missions closes, et les interroger une par une aurait fait croître son coût avec l'historique
  // de la plateforme, pas avec le nombre de reliquats à traiter.
  const soldes = await escrowBalancesFor(contracts.map((c) => c.id));

  for (const contract of contracts) {
    const balance = soldes.get(contract.id);
    // `available` et non `held` : ce qui est gelé par un litige, ou retenu en garantie, n'est pas
    // un reliquat oublié — c'est une somme qui attend encore quelque chose.
    if (!balance || balance.available <= 0) {
      report.skipped.push({ missionId: contract.missionId, reason: "nothing_to_refund" });
      continue;
    }

    try {
      const operation = await emitContractRefund({
        contractId: contract.id,
        currency: contract.mission.currency,
      });
      if (!operation) {
        report.skipped.push({ missionId: contract.missionId, reason: "nothing_to_refund" });
        continue;
      }

      report.refunded++;
      report.amount += operation.amount;

      // Les deux parties sont prévenues : le client parce que l'argent lui revient, le
      // prestataire parce qu'un mouvement sur le séquestre de SA mission ne doit pas lui être
      // invisible — même quand il ne le concerne pas directement.
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
          // Cloche seulement, pas d'e-mail : ce mouvement ne le concerne pas directement, mais
          // il ne doit pas non plus lui être invisible sur SA mission.
          message: `Le reliquat non dû du séquestre de « ${contract.mission.titre} » (${montant}) a été rendu au client.`,
        },
      });
    } catch (error) {
      console.error("[residual-refund] échec", contract.missionId, error);
      report.skipped.push({ missionId: contract.missionId, reason: "error" });
    }
  }

  return report;
}
