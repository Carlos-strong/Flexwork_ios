/**
 * Remboursement du reliquat en fin de contrat (§22 — 2026-09-14).
 *
 * « Il ne doit jamais rester un argent fantôme dans la mission. »
 *
 * Le chemin de remboursement existait, mais il fallait un administrateur pour le déclencher —
 * et personne ne surveille les soldes un par un. Les reliquats ne sont pourtant pas
 * exceptionnels : un contrat au temps finance un plafond qu'il consomme rarement en entier, une
 * médiation ne redistribue parfois qu'une partie, une journée écartée après contestation libère
 * des fonds que plus personne ne réclame.
 *
 * Ce que ce balayage ne fait PAS est aussi important : il ne décide jamais qu'une mission est
 * terminée, et il ne touche ni aux fonds gelés par un litige, ni à une retenue de garantie — ce
 * ne sont pas des reliquats oubliés, ce sont des sommes qui attendent encore quelque chose.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { escrowBalance } from "@/lib/escrow";
import { runResidualRefundSweep } from "@/lib/residual-refund";

const RUN = Date.now();
let clientId = "";
let providerId = "";
const missionIds: string[] = [];
const contractIds: string[] = [];
let seq = 0;

/** Contrat financé 300 000, dont `released` est déjà parti au prestataire. */
async function createContract(opts: {
  status: string;
  released?: number;
  frozen?: number;
}) {
  seq++;
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Mission reliquat ${RUN}-${seq}`,
      description: "Mission e2e pour le remboursement des reliquats",
      domaine: "batiment",
      budget: 300_000,
      currency: "XOF",
      delaiJours: 30,
      status: opts.status as "cloturee",
    },
  });
  missionIds.push(mission.id);

  const ops: Record<string, unknown>[] = [
    {
      pspName: "psp-virtuelle",
      pspReference: `hold_res_${RUN}_${seq}`,
      amount: 300_000,
      instructionType: "hold",
      status: "confirmed",
      pspConfirmedAt: new Date(),
      currency: "XOF",
    },
  ];
  if (opts.released) {
    ops.push({
      pspName: "psp-virtuelle",
      pspReference: `rel_res_${RUN}_${seq}`,
      amount: opts.released,
      instructionType: "release",
      status: "confirmed",
      pspConfirmedAt: new Date(),
      currency: "XOF",
    });
  }
  if (opts.frozen) {
    ops.push({
      pspName: "psp-virtuelle",
      pspReference: `frz_res_${RUN}_${seq}`,
      amount: opts.frozen,
      instructionType: "freeze",
      status: "confirmed",
      pspConfirmedAt: new Date(),
      currency: "XOF",
    });
  }

  const contract = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId,
      providerId,
      termsSnapshot: { prix: 300_000, devise: "XOF" },
      currentHash: `hash-res-${RUN}-${seq}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      escrowOperations: { create: ops as never },
    },
  });
  contractIds.push(contract.id);
  return { mission, contract };
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: `e2e-res-c-${RUN}@flexwork.test`, tel: `+229${RUN}95`, role: "client", status: "active", country: "BJ" },
  });
  const provider = await prisma.user.create({
    data: { email: `e2e-res-p-${RUN}@flexwork.test`, tel: `+229${RUN}96`, role: "expert_digital", status: "active", country: "BJ" },
  });
  clientId = client.id;
  providerId = provider.id;
});

afterAll(async () => {
  await prisma.notification.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.payable.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.prestationContract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("§22 — aucun argent fantôme", () => {
  it("une mission CLÔTURÉE avec un reliquat est remboursée au client", async () => {
    const { contract } = await createContract({ status: "cloturee", released: 240_000 });
    expect((await escrowBalance(contract.id)).held).toBe(60_000);

    await runResidualRefundSweep();

    const apres = await escrowBalance(contract.id);
    expect(apres.refunded).toBe(60_000);
    expect(apres.held).toBe(0);
  });

  it("une mission EN COURS n'est jamais touchée — le balayage ne décide pas qu'elle est finie", async () => {
    const { contract } = await createContract({ status: "livrable_soumis", released: 100_000 });
    await runResidualRefundSweep();
    expect((await escrowBalance(contract.id)).held).toBe(200_000);
  });

  it("une mission EN MÉDIATION est laissée intacte", async () => {
    // Rendre au client des fonds pendant qu'un litige les dispute reviendrait à trancher ce
    // litige en silence, et au détriment d'une partie.
    const { contract } = await createContract({ status: "mediation_ouverte", released: 50_000 });
    await runResidualRefundSweep();
    expect((await escrowBalance(contract.id)).held).toBe(250_000);
  });

  it("les fonds GELÉS ne sont pas un reliquat — ils attendent encore quelque chose", async () => {
    const { contract } = await createContract({ status: "cloturee", released: 200_000, frozen: 40_000 });
    await runResidualRefundSweep();

    const apres = await escrowBalance(contract.id);
    // 100 000 restaient, dont 40 000 gelés : seuls 60 000 sont un reliquat.
    expect(apres.refunded).toBe(60_000);
    expect(apres.blocked).toBe(40_000);
    expect(apres.held).toBe(40_000);
  });

  it("un second balayage ne rembourse RIEN de plus", async () => {
    const { contract } = await createContract({ status: "cloturee", released: 280_000 });
    await runResidualRefundSweep();
    const apres1 = await escrowBalance(contract.id);
    await runResidualRefundSweep();
    const apres2 = await escrowBalance(contract.id);

    expect(apres1.refunded).toBe(20_000);
    expect(apres2.refunded).toBe(apres1.refunded);
    expect(
      await prisma.pspEscrowOperation.count({
        where: { contractId: contract.id, instructionType: "refund" },
      })
    ).toBe(1);
  });

  it("une mission entièrement consommée n'a rien à rembourser", async () => {
    const { contract } = await createContract({ status: "cloturee", released: 300_000 });
    await runResidualRefundSweep();
    expect((await escrowBalance(contract.id)).refunded).toBe(0);
  });
});
