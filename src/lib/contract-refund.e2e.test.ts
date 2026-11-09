/**
 * Test E2E du REMBOURSEMENT du reliquat séquestré d'un contrat de mission (2026-09-14).
 *
 * Ce que ce fichier verrouille : avant ce correctif, `instructionType: "refund"` n'était émis
 * que par le domaine Gig. Un contrat de mission n'avait aucun chemin de retour — une mission
 * interrompue, abandonnée, ou close sur une médiation partielle laissait au séquestre un
 * reliquat que `heldBalance` voyait parfaitement et qu'aucune instruction ne venait chercher.
 * C'est le solde orphelin que le cahier des charges interdit (§18).
 *
 * Deux propriétés sont vérifiées ici, et ce sont celles qui distinguent un remboursement correct
 * d'un remboursement dangereux :
 *
 *   1. la borne est le solde RÉELLEMENT séquestré, jamais le prix du contrat — un contrat dont
 *      une partie est déjà partie au prestataire ne rend que ce qui reste ;
 *   2. l'appel est idempotent SANS garde de statut dédiée : une fois le solde à zéro, il n'y a
 *      plus rien à instruire, donc rien n'est instruit.
 *
 * Mode CONSOLE (pas d'autoconfirm), même raison que progressive-release et retention-release :
 * c'est le seul qui reproduit la temporalité de la production, où l'instruction reste `pending`
 * jusqu'au webhook signé. Il permet de vérifier séparément l'INSTRUCTION et l'effet de sa
 * CONFIRMATION sur le statut de la mission.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { emitContractRefund, heldBalance } from "@/lib/escrow";
import { operateVirtualPsp } from "@/lib/psp-virtual";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-refund-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-refund-provider-${RUN}@flexwork.test`;
const PRIX = 400_000;

let clientId = "";
let providerId = "";
const missionIds: string[] = [];
const contractIds: string[] = [];

// Contrat financé : un HOLD confirmé au prix du contrat, l'état dans lequel toute mission se
// trouve après la mise sous séquestre.
async function createFundedContract(opts: { alreadyReleased?: number } = {}) {
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Mission remboursement ${RUN}`,
      description: "Mission e2e pour le chemin de remboursement",
      domaine: "batiment",
      budget: PRIX,
      currency: "XOF",
      delaiJours: 30,
      status: "fonds_sous_sequestre",
    },
  });
  missionIds.push(mission.id);

  const contract = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId,
      providerId,
      termsSnapshot: { prix: PRIX, devise: "XOF" },
      currentHash: `hash-refund-${RUN}-${missionIds.length}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      escrowOperations: {
        create: {
          pspName: "psp-virtuelle",
          pspReference: `hold_refund_${RUN}_${missionIds.length}`,
          amount: PRIX,
          currency: "XOF",
          instructionType: "hold",
          status: "confirmed",
          pspConfirmedAt: new Date(),
        },
      },
    },
  });
  contractIds.push(contract.id);

  // Une part déjà versée au prestataire : le reliquat remboursable en est diminué d'autant.
  if (opts.alreadyReleased) {
    await prisma.pspEscrowOperation.create({
      data: {
        contractId: contract.id,
        pspName: "psp-virtuelle",
        pspReference: `release_refund_${RUN}_${contractIds.length}`,
        amount: opts.alreadyReleased,
        currency: "XOF",
        instructionType: "release",
        status: "confirmed",
        pspConfirmedAt: new Date(),
      },
    });
  }

  return { mission, contract };
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}6`, role: "client", status: "active", country: "BJ" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}7`, role: "expert_digital", status: "active", country: "BJ" },
  });
  clientId = client.id;
  providerId = provider.id;
});

afterAll(async () => {
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.prestationContract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("remboursement du reliquat séquestré", () => {
  it("sans montant demandé, rend TOUT le reliquat et vide le séquestre", async () => {
    const { contract } = await createFundedContract();
    expect(await heldBalance(contract.id)).toBe(PRIX);

    const op = await emitContractRefund({ contractId: contract.id, currency: "XOF" });
    expect(op?.amount).toBe(PRIX);
    expect(op?.instructionType).toBe("refund");
    expect(await heldBalance(contract.id)).toBe(0);
  });

  it("la borne est le SOLDE, pas le prix du contrat — ce qui est déjà parti n'est pas rendu", async () => {
    const { contract } = await createFundedContract({ alreadyReleased: 250_000 });
    expect(await heldBalance(contract.id)).toBe(150_000);

    const op = await emitContractRefund({ contractId: contract.id, currency: "XOF" });
    // 150 000 et non 400 000 : rembourser le prix du contrat aurait fait sortir 650 000 d'un
    // séquestre qui n'en a jamais contenu que 400 000.
    expect(op?.amount).toBe(150_000);
    expect(await heldBalance(contract.id)).toBe(0);
  });

  it("un montant demandé au-dessus du solde est ramené au solde", async () => {
    const { contract } = await createFundedContract({ alreadyReleased: 300_000 });
    const op = await emitContractRefund({ contractId: contract.id, currency: "XOF", requested: 999_999 });
    expect(op?.amount).toBe(100_000);
  });

  it("un remboursement PARTIEL laisse le reste séquestré", async () => {
    const { contract } = await createFundedContract();
    const op = await emitContractRefund({ contractId: contract.id, currency: "XOF", requested: 100_000 });
    expect(op?.amount).toBe(100_000);
    expect(await heldBalance(contract.id)).toBe(300_000);
  });

  it("un second appel n'instruit RIEN — idempotent par le solde, sans garde de statut", async () => {
    const { contract } = await createFundedContract();
    await emitContractRefund({ contractId: contract.id, currency: "XOF" });

    expect(await emitContractRefund({ contractId: contract.id, currency: "XOF" })).toBeNull();

    const refunds = await prisma.pspEscrowOperation.count({
      where: { contractId: contract.id, instructionType: "refund" },
    });
    expect(refunds).toBe(1);
  });

  it("deux remboursements SIMULTANÉS ne sortent jamais plus que le séquestre", async () => {
    const { contract } = await createFundedContract();

    const [a, b] = await Promise.all([
      emitContractRefund({ contractId: contract.id, currency: "XOF" }),
      emitContractRefund({ contractId: contract.id, currency: "XOF" }),
    ]);
    const total = (a?.amount ?? 0) + (b?.amount ?? 0);
    expect(total).toBe(PRIX);
    expect(await heldBalance(contract.id)).toBe(0);
  });

  it("la confirmation PSP passe la mission `remboursee`, pas `cloturee`", async () => {
    const { mission, contract } = await createFundedContract();
    const op = await emitContractRefund({ contractId: contract.id, currency: "XOF" });

    // L'instruction seule ne change RIEN au statut : jamais de clôture optimiste.
    expect((await prisma.mission.findUnique({ where: { id: mission.id } }))?.status).toBe(
      "fonds_sous_sequestre"
    );

    expect((await operateVirtualPsp("refund", op!.pspReference!)).ok).toBe(true);

    const after = await prisma.mission.findUnique({ where: { id: mission.id } });
    // `remboursee` et non `cloturee` : un abandon n'est pas une mission menée à terme.
    expect(after?.status).toBe("remboursee");
  });

  it("une mission en médiation garde son statut — solder le séquestre ne tranche pas le litige", async () => {
    const { mission, contract } = await createFundedContract();
    await prisma.mission.update({ where: { id: mission.id }, data: { status: "mediation_ouverte" } });

    const op = await emitContractRefund({ contractId: contract.id, currency: "XOF" });
    expect((await operateVirtualPsp("refund", op!.pspReference!)).ok).toBe(true);

    const after = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(after?.status).toBe("mediation_ouverte");
  });

  it("une mission déjà clôturée n'est pas requalifiée par un remboursement de reliquat", async () => {
    const { mission, contract } = await createFundedContract();
    await prisma.mission.update({ where: { id: mission.id }, data: { status: "cloturee" } });

    const op = await emitContractRefund({ contractId: contract.id, currency: "XOF" });
    expect((await operateVirtualPsp("refund", op!.pspReference!)).ok).toBe(true);

    const after = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(after?.status).toBe("cloturee");
  });
});
