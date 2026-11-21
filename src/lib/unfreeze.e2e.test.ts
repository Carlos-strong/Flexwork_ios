/**
 * Levée du gel — Phase 3.4, 2026-09-14.
 *
 * Le gel et sa levée ouvrent et referment la parenthèse pendant laquelle les fonds d'un contrat
 * ne peuvent pas bouger. La seconde moitié manquait : POST /api/admin/mediations/[id]/respond
 * notait explicitement « ce que cette route ne fait toujours PAS : dégeler les fonds au PSP ».
 *
 * La conséquence n'était pas théorique. Une médiation close restaurait le statut de la mission —
 * elle reprenait son cours — mais le gel restait en vigueur : `available` retranche ce qui est
 * bloqué, donc plus AUCUNE libération ne pouvait sortir du séquestre. Le litige était réglé, et
 * l'argent restait immobilisé.
 *
 * Mode CONSOLE : les instructions restent `pending` jusqu'au webhook signé, ce qui permet de
 * distinguer l'instruction de son effet.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { emitUnfreeze, escrowBalance, emitMediationRelease } from "@/lib/escrow";
import { operateVirtualPsp } from "@/lib/psp-virtual";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-unfreeze-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-unfreeze-provider-${RUN}@flexwork.test`;
const PRIX = 300_000;

let clientId = "";
let providerId = "";
const missionIds: string[] = [];
const contractIds: string[] = [];
let seq = 0;

/** Contrat financé, dont les fonds sont gelés par une médiation ouverte. */
async function createFrozen(freezeAmount = PRIX) {
  seq++;
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Mission dégel ${RUN}-${seq}`,
      description: "Mission e2e pour la levée du gel",
      domaine: "batiment",
      budget: PRIX,
      currency: "XOF",
      delaiJours: 30,
      status: "mediation_ouverte",
    },
  });
  missionIds.push(mission.id);

  const contract = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId,
      providerId,
      termsSnapshot: { prix: PRIX, devise: "XOF" },
      currentHash: `hash-unfreeze-${RUN}-${seq}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      escrowOperations: {
        create: [
          {
            pspName: "psp-virtuelle",
            pspReference: `hold_unfreeze_${RUN}_${seq}`,
            amount: PRIX,
            currency: "XOF",
            instructionType: "hold",
            status: "confirmed",
            pspConfirmedAt: new Date(),
          },
          {
            pspName: "psp-virtuelle",
            pspReference: `freeze_unfreeze_${RUN}_${seq}`,
            amount: freezeAmount,
            currency: "XOF",
            instructionType: "freeze",
            status: "confirmed",
            pspConfirmedAt: new Date(),
          },
        ],
      },
    },
  });
  contractIds.push(contract.id);
  return { mission, contract };
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}40`, role: "client", status: "active", country: "BJ" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}41`, role: "expert_digital", status: "active", country: "BJ" },
  });
  clientId = client.id;
  providerId = provider.id;
});

afterAll(async () => {
  await prisma.payable.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.prestationContract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("levée du gel", () => {
  it("un gel rend le séquestre indisponible ; sa levée le rend de nouveau mobilisable", async () => {
    const { contract } = await createFrozen();
    expect(await escrowBalance(contract.id)).toMatchObject({ held: PRIX, blocked: PRIX, available: 0 });

    const op = await emitUnfreeze({ contractId: contract.id, currency: "XOF" });
    expect(op?.amount).toBe(PRIX);
    expect(op?.instructionType).toBe("unfreeze");

    const after = await escrowBalance(contract.id);
    expect(after).toMatchObject({ held: PRIX, blocked: 0, available: PRIX });
    // Le dégel ne DÉPLACE rien : rien n'est sorti, rien n'est entré.
    expect(after.released).toBe(0);
    expect(after.refunded).toBe(0);
  });

  it("après une libération de médiation, le dégel lève l'ORDRE ENTIER et rend tout le reste disponible", async () => {
    // Entre le gel et sa levée, une résolution de médiation a libéré une partie des fonds. Le
    // gel portait 300 000, il n'en reste que 200 000 : `blocked` est alors plafonné par le
    // solde, mais l'ORDRE de gel, lui, porte toujours 300 000. C'est lui que la levée doit
    // annuler — sinon un reliquat d'ordre subsiste et `blocked` ne retombe jamais à zéro.
    const { contract } = await createFrozen();

    // Une médiation ne peut PAS libérer des fonds gelés sans les dégeler (règle unifiée
    // 2026-09-14 : toute sortie est bornée par le disponible). Elle dégèle donc d'abord ce
    // qu'elle distribue — c'est exactement ce que fait la route de résolution.
    expect(
      await emitMediationRelease({ contractId: contract.id, currency: "XOF", requested: 100_000 })
    ).toBeNull();

    await emitUnfreeze({ contractId: contract.id, currency: "XOF", amount: 100_000 });
    const release = await emitMediationRelease({
      contractId: contract.id,
      currency: "XOF",
      requested: 100_000,
    });
    expect(release?.amount).toBe(100_000);
    // 200 000 restent, et le solde de l'ordre de gel (200 000) les couvre encore entièrement.
    expect(await escrowBalance(contract.id)).toMatchObject({ held: 200_000, blocked: 200_000, available: 0 });

    const op = await emitUnfreeze({ contractId: contract.id, currency: "XOF" });
    // 200 000 : le dégel ciblé de 100 000 a déjà levé sa part de l'ordre de 300 000.
    expect(op?.amount).toBe(200_000);

    // Ce qui compte : plus rien n'est bloqué, et tout le solde restant est de nouveau mobilisable.
    expect(await escrowBalance(contract.id)).toMatchObject({ held: 200_000, blocked: 0, available: 200_000 });
  });

  it("un second dégel n'instruit RIEN — idempotent par le solde bloqué", async () => {
    const { contract } = await createFrozen();
    expect(await emitUnfreeze({ contractId: contract.id, currency: "XOF" })).not.toBeNull();
    expect(await emitUnfreeze({ contractId: contract.id, currency: "XOF" })).toBeNull();

    expect(
      await prisma.pspEscrowOperation.count({
        where: { contractId: contract.id, instructionType: "unfreeze" },
      })
    ).toBe(1);
  });

  it("sans gel en vigueur, rien à dégeler", async () => {
    const { contract } = await createFrozen(0);
    await prisma.pspEscrowOperation.deleteMany({
      where: { contractId: contract.id, instructionType: "freeze" },
    });
    expect(await emitUnfreeze({ contractId: contract.id, currency: "XOF" })).toBeNull();
  });

  it("deux dégels SIMULTANÉS n'en produisent qu'un", async () => {
    const { contract } = await createFrozen();
    const [a, b] = await Promise.all([
      emitUnfreeze({ contractId: contract.id, currency: "XOF" }),
      emitUnfreeze({ contractId: contract.id, currency: "XOF" }),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
  });

  it("la confirmation PSP passe par le chemin webhook signé, sans transition métier", async () => {
    const { contract, mission } = await createFrozen();
    const op = await emitUnfreeze({ contractId: contract.id, currency: "XOF" });
    expect((await operateVirtualPsp("unfreeze", op!.pspReference!)).ok).toBe(true);

    const confirmed = await prisma.pspEscrowOperation.findUnique({ where: { id: op!.id } });
    expect(confirmed?.status).toBe("confirmed");
    // Le dégel ne décide rien du cycle de vie : c'est la clôture de la médiation qui a restauré
    // le statut, pas l'instruction financière.
    expect((await prisma.mission.findUnique({ where: { id: mission.id } }))?.status).toBe(
      "mediation_ouverte"
    );
  });
});
