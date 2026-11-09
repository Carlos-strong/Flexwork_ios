import { prisma } from "@/lib/db";
import { instructOwedPayables } from "@/lib/escrow";
import { emitRetentionRelease } from "@/lib/psp-webhook";
import { totalRetentionAmount } from "@/lib/jalons";
import { completeGigOrder } from "@/lib/gig-completion";
import { executeMediationAgreement } from "@/lib/mediation-execution";
import { notifyBoth } from "@/lib/notify";

// Compte de versement vérifié (2026-11-02, politique KYC) : tout ce qui attendait ce compte part
// maintenant. Quatre attentes, quatre reprises — chacune par le chemin qui l'a retenue, pour
// rejouer exactement ses gardes (séquestre disponible, idempotence sous verrou) :
//
//   - créances de mission (jalon, mission, relevé) → instructOwedPayables, par contrat ;
//   - retenue de garantie d'un contrat dont tous les jalons sont libérés → emitRetentionRelease ;
//   - accords de médiation scellés en attente d'exécution → executeMediationAgreement ;
//   - commandes Gig validées, versement en attente → completeGigOrder.
//
// Le règlement d'une retenue sur mission ARRÊTÉE (jalons non tous libérés) n'est pas repris : c'est
// un arbitrage de l'admin médiation, qui relance POST .../retention/settle.
//
// Appelé par la décision admin sur le compte de versement. Chaque reprise est isolée : un échec
// n'empêche pas les suivantes, et ce qui n'est pas parti reste dû et reprenable.

export type AwaitingPayoutsReport = { instructed: number; waiting: number; retentions: number; mediations: number; gigOrders: number };

async function attempt(label: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    console.error(`[payout-release] reprise ${label} échouée (non bloquant) :`, e);
  }
}

export async function releaseAwaitingPayouts(providerId: string): Promise<AwaitingPayoutsReport> {
  const report: AwaitingPayoutsReport = { instructed: 0, waiting: 0, retentions: 0, mediations: 0, gigOrders: 0 };

  const owed = await prisma.prestationContract.findMany({
    where: { providerId, payables: { some: { status: "validated" } } },
    select: { id: true },
  });
  for (const c of owed) {
    await attempt(`créances ${c.id}`, async () => {
      const res = await instructOwedPayables(c.id);
      report.instructed += res.instructed;
      report.waiting += res.waiting;
    });
  }

  const retained = await prisma.prestationContract.findMany({
    where: {
      providerId,
      retentionRate: { gt: 0 },
      jalons: { some: {}, every: { status: "libere" } },
      mission: { status: { notIn: ["cloturee", "mediation_ouverte"] } },
    },
    select: {
      id: true,
      missionId: true,
      retentionRate: true,
      mission: { select: { currency: true } },
      jalons: { select: { montant: true, status: true } },
    },
  });
  for (const c of retained) {
    await attempt(`retenue ${c.id}`, async () => {
      // Idempotent : une retenue déjà en vol ou soldée n'est pas réémise (garde sous verrou).
      const res = await emitRetentionRelease({
        contractId: c.id,
        missionId: c.missionId,
        amount: totalRetentionAmount(c.jalons, c.retentionRate),
        currency: c.mission.currency,
        missionStatus: "validee",
      });
      if (res.emitted) report.retentions++;
    });
  }

  const mediations = await prisma.mediation.findMany({
    where: { outcome: "en_cours", clientAccepted: true, providerAccepted: true, contract: { providerId } },
    select: { id: true },
  });
  for (const m of mediations) {
    await attempt(`médiation ${m.id}`, async () => {
      if ((await executeMediationAgreement(m.id)).executed) report.mediations++;
    });
  }

  const gigOrders = await prisma.gigOrder.findMany({
    where: { providerId, status: "active" },
    select: { id: true, clientId: true, gig: { select: { titre: true } } },
  });
  for (const o of gigOrders) {
    // Seules les commandes dont le client a validé la livraison portent une créance finale.
    const due = await prisma.payable.findFirst({
      where: { idempotencyKey: `gig:${o.id}:final`, status: "validated" },
      select: { id: true },
    });
    if (!due) continue;
    await attempt(`commande Gig ${o.id}`, async () => {
      const res = await completeGigOrder(o.id);
      if (!res.ok) return;
      report.gigOrders++;
      const montant = `${res.amount.toLocaleString("fr-FR")} ${res.currency}`;
      await notifyBoth({
        type: "gig_order_completed",
        counterpart: {
          userId: providerId,
          message: `Compte de versement vérifié — ${montant} libérés pour « ${o.gig.titre} ».`,
        },
        actor: {
          userId: o.clientId,
          message: `Le versement de ${montant} pour « ${o.gig.titre} » est parti au prestataire : la commande est clôturée.`,
        },
      });
    });
  }

  return report;
}
