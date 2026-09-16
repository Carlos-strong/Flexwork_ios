/**
 * Unification des deux moteurs de séquestre — 0.1, 2026-09-14.
 *
 * Le cahier des charges ouvre sur une consigne : « ne crée pas un deuxième moteur financier ».
 * Il en existait déjà un — `GigOrderEscrowOperation`, jumelle de `PspEscrowOperation` : mêmes
 * colonnes, mêmes enums, aucun code partagé. Les deux domaines écrivent désormais dans le même
 * registre, distingués par `sourceType`.
 *
 * Ce que ce fichier vérifie, et qui n'était PAS vérifiable avant :
 *
 *   1. les deux domaines cohabitent sans se mélanger — un solde de mission ignore les opérations
 *      d'une commande, et réciproquement ;
 *   2. la base REFUSE une opération mal rattachée. Tant que chaque domaine avait sa table,
 *      aucune contrainte ne pouvait exprimer « exactement une portée » ;
 *   3. le dispatch webhook, qui ne connaît que le domaine des contrats, refuse explicitement
 *      tout ce qui n'en relève pas.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { escrowBalance } from "@/lib/escrow";
import { gigHeldBalance, completeGigOrder } from "@/lib/gig-completion";
import { applyPspWebhookEvent } from "@/lib/psp-webhook";
import { signWebhookPayload } from "@/lib/webhook-signing";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-unif-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-unif-provider-${RUN}@flexwork.test`;

let clientId = "";
let providerId = "";
let missionId = "";
let contractId = "";
let gigId = "";
let orderId = "";

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}50`, role: "client", status: "active", country: "BJ" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}51`, role: "expert_digital", status: "active", country: "BJ" },
  });
  clientId = client.id;
  providerId = provider.id;

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Mission unification ${RUN}`,
      description: "Mission e2e pour l'unification des registres",
      domaine: "batiment",
      budget: 300_000,
      currency: "XOF",
      delaiJours: 30,
      status: "fonds_sous_sequestre",
    },
  });
  missionId = mission.id;

  const contract = await prisma.prestationContract.create({
    data: {
      missionId,
      clientId,
      providerId,
      termsSnapshot: { prix: 300_000, devise: "XOF" },
      currentHash: `hash-unif-${RUN}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      escrowOperations: {
        create: {
          pspName: "psp-virtuelle",
          pspReference: `hold_unif_${RUN}`,
          amount: 300_000,
          currency: "XOF",
          instructionType: "hold",
          status: "confirmed",
          pspConfirmedAt: new Date(),
        },
      },
    },
  });
  contractId = contract.id;

  const gig = await prisma.gig.create({
    data: {
      providerId,
      titre: `Gig unification ${RUN}`,
      description: "Prestation forfaitaire",
      domaine: "batiment",
      prix: 80_000,
      currency: "XOF",
      delaiJours: 5,
      status: "publie",
    },
  });
  gigId = gig.id;

  const order = await prisma.gigOrder.create({
    data: {
      gigId,
      clientId,
      providerId,
      montant: 80_000,
      currency: "XOF",
      termsSnapshot: { prix: 80_000 },
      status: "active",
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      escrowOperations: {
        create: {
          sourceType: "gig_order",
          pspName: "gig-hold",
          amount: 80_000,
          currency: "XOF",
          instructionType: "hold",
          status: "confirmed",
          pspConfirmedAt: new Date(),
        },
      },
    },
  });
  orderId = order.id;
});

afterAll(async () => {
  await prisma.payable.deleteMany({ where: { contractId } });
  await prisma.pspEscrowOperation.deleteMany({ where: { OR: [{ contractId }, { orderId }] } });
  await prisma.prestationContract.deleteMany({ where: { id: contractId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.gigOrder.deleteMany({ where: { id: orderId } });
  await prisma.gig.deleteMany({ where: { id: gigId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("un seul registre, deux domaines", () => {
  it("l'ancienne table n'existe plus", async () => {
    const rows = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables WHERE table_name = 'GigOrderEscrowOperation'
      ) AS "exists"`;
    expect(rows[0].exists).toBe(false);
  });

  it("les deux portées cohabitent dans la même table", async () => {
    const [mission, gig] = await Promise.all([
      prisma.pspEscrowOperation.count({ where: { contractId, sourceType: "mission_contract" } }),
      prisma.pspEscrowOperation.count({ where: { orderId, sourceType: "gig_order" } }),
    ]);
    expect(mission).toBe(1);
    expect(gig).toBe(1);
  });

  it("les soldes ne se mélangent PAS — chacun ne voit que sa portée", async () => {
    expect((await escrowBalance(contractId)).held).toBe(300_000);
    expect(await gigHeldBalance(orderId)).toBe(80_000);
  });

  it("payer la commande Gig ne touche pas au séquestre de la mission", async () => {
    expect(await completeGigOrder(orderId)).toMatchObject({ ok: true, amount: 80_000 });
    expect(await gigHeldBalance(orderId)).toBe(0);
    // Le séquestre de la mission est intact : c'est tout l'enjeu d'un registre partagé.
    expect((await escrowBalance(contractId)).held).toBe(300_000);
  });
});

describe("intégrité de la portée — ce que la base refuse désormais", () => {
  const scopeViolation = (data: Record<string, unknown>) =>
    prisma.pspEscrowOperation.create({
      data: {
        pspName: "psp-virtuelle",
        amount: 1_000,
        currency: "XOF",
        instructionType: "hold",
        ...data,
      } as never,
    });

  it("une opération SANS portée est refusée", async () => {
    await expect(scopeViolation({ sourceType: "mission_contract" })).rejects.toThrow();
  });

  it("une opération rattachée aux DEUX domaines est refusée", async () => {
    await expect(
      scopeViolation({ sourceType: "mission_contract", contractId, orderId })
    ).rejects.toThrow();
  });

  it("un discriminant incohérent avec la portée est refusé", async () => {
    // `gig_order` avec un contractId : la contrainte lit le couple, pas seulement la présence.
    await expect(scopeViolation({ sourceType: "gig_order", contractId })).rejects.toThrow();
    await expect(scopeViolation({ sourceType: "mission_contract", orderId })).rejects.toThrow();
  });
});

describe("le dispatch webhook reste cantonné aux contrats", () => {
  it("refuse explicitement une opération hors de sa portée", async () => {
    // Une opération Gig avec une référence PSP ne peut pas arriver en production — le domaine
    // Gig n'a pas de webhook et crée ses instructions confirmées. La garde est là pour que
    // l'invariance soit vérifiée plutôt que supposée.
    const op = await prisma.pspEscrowOperation.create({
      data: {
        sourceType: "gig_order",
        orderId,
        pspName: "psp-virtuelle",
        pspReference: `release_hors_portee_${RUN}`,
        amount: 1_000,
        currency: "XOF",
        instructionType: "release",
      },
    });

    const payload = { pspReference: op.pspReference!, event: "release_confirmed" as const };
    const result = await applyPspWebhookEvent(
      payload,
      signWebhookPayload(payload as unknown as Record<string, unknown>)
    );
    expect(result).toEqual({ ok: false, error: "operation_out_of_scope" });

    // Et rien n'a bougé : l'opération reste en attente, aucune transition métier n'a eu lieu.
    expect((await prisma.pspEscrowOperation.findUnique({ where: { id: op.id } }))?.status).toBe(
      "pending"
    );
  });
});
