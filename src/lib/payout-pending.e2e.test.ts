/**
 * Versements retenus faute de compte de versement vérifié (politique KYC, 2026-11-02) — les trois
 * sorties hors créance de mission, que payable.e2e ne couvre pas :
 *
 *   1. commande Gig validée → créance due, commande `active` ; vérification → payée, clôturée ;
 *   2. retenue de garantie → rien n'est émis ; vérification → instruction `retention_release` ;
 *   3. accord de médiation → non exécuté, fonds gelés ; vérification → exécuté, médiation close.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { completeGigOrder } from "@/lib/gig-completion";
import { emitRetentionRelease } from "@/lib/psp-webhook";
import { executeMediationAgreement } from "@/lib/mediation-execution";
import { releaseAwaitingPayouts } from "@/lib/payout-release";
import { givePayoutAccount } from "@/test/payout-fixture";

const RUN = Date.now();
let clientId = "";
let providerId = "";
let gigId = "";
const missionIds: string[] = [];
const contractIds: string[] = [];
const orderIds: string[] = [];
let seq = 0;

const setPayout = (status: "en_attente" | "verifie") =>
  prisma.payoutAccount.update({ where: { userId: providerId }, data: { status } });

const confirmedOp = (type: "hold" | "release" | "freeze", amount: number) => ({
  pspName: "psp-virtuelle",
  pspReference: `${type}_pp_${RUN}_${++seq}`,
  amount,
  currency: "XOF",
  instructionType: type,
  status: "confirmed" as const,
  pspConfirmedAt: new Date(),
});

async function createContract(opts: {
  missionStatus: "en_cours" | "mediation_ouverte";
  retentionRate?: number;
  jalon?: { montant: number; status: "libere" };
  ops: ReturnType<typeof confirmedOp>[];
}) {
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Mission versement ${RUN}-${++seq}`,
      description: "Mission e2e : versement retenu faute de compte vérifié",
      domaine: "batiment",
      budget: 100_000,
      currency: "XOF",
      delaiJours: 30,
      status: opts.missionStatus,
    },
  });
  missionIds.push(mission.id);
  const contract = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId,
      providerId,
      termsSnapshot: { prix: 100_000, devise: "XOF" },
      currentHash: `hash-pp-${RUN}-${seq}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      retentionRate: opts.retentionRate ?? 0,
      ...(opts.jalon ? { jalons: { create: { ordre: 1, titre: "Jalon unique", ...opts.jalon } } } : {}),
      escrowOperations: { create: opts.ops },
    },
  });
  contractIds.push(contract.id);
  return { mission, contract };
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;
  clientId = (
    await prisma.user.create({
      data: { email: `pp-client-${RUN}@flexwork.test`, tel: `+229${RUN}41`, role: "client", status: "active", country: "BJ", kycStatus: "verifie" },
    })
  ).id;
  providerId = (
    await prisma.user.create({
      data: { email: `pp-presta-${RUN}@flexwork.test`, tel: `+229${RUN}42`, role: "expert_digital", status: "active", country: "BJ", kycStatus: "verifie" },
    })
  ).id;
  await givePayoutAccount(providerId);
  await setPayout("en_attente");
  gigId = (
    await prisma.gig.create({
      data: { providerId, titre: `Gig versement ${RUN}`, description: "Gig e2e", domaine: "batiment", prix: 50_000, currency: "XOF", delaiJours: 5, status: "publie" },
    })
  ).id;
});

afterAll(async () => {
  await prisma.payable.deleteMany({ where: { OR: [{ contractId: { in: contractIds } }, { sourceId: { in: orderIds } }] } });
  await prisma.pspEscrowOperation.deleteMany({ where: { OR: [{ contractId: { in: contractIds } }, { orderId: { in: orderIds } }] } });
  await prisma.mediation.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.jalon.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.prestationContract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.gigOrder.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.gig.deleteMany({ where: { id: gigId } });
  await prisma.missionNotification.deleteMany({ where: { userId: { in: [clientId, providerId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("compte de versement non vérifié : rien ne part, tout reste dû", () => {
  let orderId = "";
  let retentionContractId = "";
  let mediationId = "";

  it("commande Gig : la validation laisse une créance due, la commande reste engagée", async () => {
    const order = await prisma.gigOrder.create({
      data: {
        gigId,
        clientId,
        providerId,
        montant: 50_000,
        currency: "XOF",
        termsSnapshot: { prix: 50_000, currency: "XOF" },
        status: "active",
        clientSignedAt: new Date(),
        providerSignedAt: new Date(),
        escrowOperations: { create: { ...confirmedOp("hold", 50_000), sourceType: "gig_order", pspName: "gig-hold" } },
      },
    });
    orderIds.push(order.id);
    orderId = order.id;

    expect(await completeGigOrder(order.id)).toEqual({ ok: false, error: "payout_unverified" });
    expect((await prisma.gigOrder.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("active");
    const payable = await prisma.payable.findUniqueOrThrow({ where: { idempotencyKey: `gig:${order.id}:final` } });
    expect(payable).toMatchObject({ status: "validated", amount: 50_000, escrowOperationId: null });
    expect(await prisma.pspEscrowOperation.count({ where: { orderId: order.id, instructionType: "release" } })).toBe(0);
  });

  it("retenue de garantie : aucune instruction émise", async () => {
    const { contract, mission } = await createContract({
      missionStatus: "en_cours",
      retentionRate: 0.05,
      jalon: { montant: 100_000, status: "libere" },
      ops: [confirmedOp("hold", 100_000), confirmedOp("release", 95_000)],
    });
    retentionContractId = contract.id;
    const res = await emitRetentionRelease({ contractId: contract.id, missionId: mission.id, amount: 5_000, currency: "XOF", missionStatus: "validee" });
    expect(res).toEqual({ emitted: false, reason: "payout_unverified" });
    expect(await prisma.pspEscrowOperation.count({ where: { contractId: contract.id, instructionType: "retention_release" } })).toBe(0);
  });

  it("médiation : l'accord scellé n'est pas exécuté, les fonds restent gelés", async () => {
    const { contract } = await createContract({
      missionStatus: "mediation_ouverte",
      ops: [confirmedOp("hold", 100_000), confirmedOp("freeze", 100_000)],
    });
    const mediation = await prisma.mediation.create({
      data: {
        contractId: contract.id,
        openedById: clientId,
        reason: "Livrable contesté",
        resolutionAmount: 60_000,
        previousStatus: "livrable_soumis",
        clientAccepted: true,
        providerAccepted: true,
      },
    });
    mediationId = mediation.id;

    expect(await executeMediationAgreement(mediation.id)).toEqual({ executed: false, reason: "payout_unverified" });
    expect((await prisma.mediation.findUniqueOrThrow({ where: { id: mediation.id } })).outcome).toBe("en_cours");
    expect(await prisma.pspEscrowOperation.count({ where: { contractId: contract.id, instructionType: { in: ["unfreeze", "release"] } } })).toBe(0);
  });

  it("vérification du compte : les trois versements partent", async () => {
    await setPayout("verifie");
    const report = await releaseAwaitingPayouts(providerId);
    expect(report).toMatchObject({ gigOrders: 1, retentions: 1, mediations: 1 });

    // Gig : payée et clôturée.
    expect((await prisma.gigOrder.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("completed");
    expect((await prisma.payable.findUniqueOrThrow({ where: { idempotencyKey: `gig:${orderId}:final` } })).status).toBe("paid");

    // Retenue : instruite pour le solde retenu, mission annoncée « validée ».
    const retention = await prisma.pspEscrowOperation.findFirstOrThrow({ where: { contractId: retentionContractId, instructionType: "retention_release" } });
    expect(retention.amount).toBe(5_000);

    // Médiation : exécutée — dégel puis versement de la part du prestataire, médiation close.
    const closed = await prisma.mediation.findUniqueOrThrow({ where: { id: mediationId }, include: { contract: { include: { mission: true } } } });
    expect(closed.outcome).toBe("agreement");
    expect(closed.contract.mission.status).toBe("livrable_soumis");
    const release = await prisma.pspEscrowOperation.findFirstOrThrow({ where: { contractId: closed.contractId, instructionType: "release", status: "pending" } });
    expect(release.amount).toBe(60_000);

    // Rejouée : plus rien n'attend, rien n'est réémis.
    expect(await releaseAwaitingPayouts(providerId)).toMatchObject({ gigOrders: 0, retentions: 0, mediations: 0 });
  });
});
