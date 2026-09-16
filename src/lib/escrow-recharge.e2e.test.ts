/**
 * Recharge du séquestre (§13 du cahier des charges, Phase 3 — 2026-09-14).
 *
 * La Phase 1 a posé la règle : une validation dont le séquestre ne couvre pas le montant ne
 * transmet AUCUNE instruction — jamais de paiement partiel implicite — et le payable reste dû.
 * Il manquait la suite : le geste qui permet au client de compléter.
 *
 * Deux propriétés distinguent une recharge correcte d'une recharge dangereuse :
 *
 *   1. le montant est DÉRIVÉ de ce qui est dû, jamais saisi — sinon le séquestre peut rester
 *      partiellement couvert, c'est-à-dire l'état exact que le §13 refuse ;
 *   2. elle ne peut pas faire payer deux fois : tant qu'un financement est en vol, aucune
 *      nouvelle demande.
 *
 * Mode CONSOLE (pas d'autoconfirm) : c'est le seul qui reproduit la temporalité de la
 * production, où un HOLD reste `pending` jusqu'au webhook signé — donc le seul où l'on peut
 * observer la garde « un financement est déjà en vol ».
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { emitScopedRelease, escrowBalance } from "@/lib/escrow";
import { rechargeNeed, requestRecharge } from "@/lib/escrow-recharge";
import { operateVirtualPsp } from "@/lib/psp-virtual";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-recharge-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-recharge-provider-${RUN}@flexwork.test`;
const JALON = 200_000;

let clientId = "";
let providerId = "";
const missionIds: string[] = [];
const contractIds: string[] = [];
let seq = 0;

/** Contrat signé, sous-financé : le jalon vaut 200 000, le client n'en a séquestré que `held`. */
async function createUnderfunded(held: number, missionStatus = "fonds_sous_sequestre") {
  seq++;
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Mission recharge ${RUN}-${seq}`,
      description: "Mission e2e pour la recharge du séquestre",
      domaine: "batiment",
      budget: JALON,
      currency: "XOF",
      delaiJours: 30,
      riskLevel: "low",
      status: missionStatus as "fonds_sous_sequestre",
    },
  });
  missionIds.push(mission.id);

  const contract = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId,
      providerId,
      termsSnapshot: { prix: JALON, devise: "XOF" },
      currentHash: `hash-recharge-${RUN}-${seq}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      jalons: { create: { ordre: 1, titre: `Jalon ${seq}`, montant: JALON, status: "livrable_soumis" } },
      escrowOperations: {
        create: {
          pspName: "psp-virtuelle",
          pspReference: `hold_init_${RUN}_${seq}`,
          amount: held,
          currency: "XOF",
          instructionType: "hold",
          status: "confirmed",
          pspConfirmedAt: new Date(),
        },
      },
    },
    include: { jalons: true },
  });
  contractIds.push(contract.id);
  return { mission, contract, jalon: contract.jalons[0] };
}

/** Provoque une validation que le séquestre ne couvre pas : le payable reste dû. */
async function validateBeyondEscrow(contractId: string, jalonId: string) {
  const res = await emitScopedRelease({
    contractId,
    jalonId,
    currency: "XOF",
    plafond: JALON,
    targetCumulative: JALON,
  });
  expect(res).toMatchObject({ ok: false, reason: "escrow_insufficient" });
  return res;
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}30`, role: "client", status: "active", country: "BJ" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}31`, role: "expert_digital", status: "active", country: "BJ" },
  });
  clientId = client.id;
  providerId = provider.id;
});

afterAll(async () => {
  await prisma.payable.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.jalon.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.prestationContract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("ce qui manque au séquestre", () => {
  it("un séquestre qui couvre tout ne demande rien", async () => {
    const { contract } = await createUnderfunded(JALON);
    expect(await rechargeNeed(contract.id)).toMatchObject({ due: 0, missing: 0 });
  });

  it("après une validation non couverte, le manque est exactement la différence", async () => {
    const { contract, jalon } = await createUnderfunded(120_000);
    await validateBeyondEscrow(contract.id, jalon.id);

    expect(await rechargeNeed(contract.id)).toMatchObject({
      due: JALON,
      available: 120_000,
      missing: 80_000,
      currency: "XOF",
      pendingHold: false,
    });
  });

  it("le manque se fonde sur les PAYABLES, pas sur le prix du contrat", async () => {
    // Sous-financé, mais rien n'a encore été validé : le client ne doit RIEN. Réclamer un
    // complément ici lui ferait financer d'avance un travail qu'il n'a pas approuvé.
    const { contract } = await createUnderfunded(120_000);
    expect(await rechargeNeed(contract.id)).toMatchObject({ due: 0, missing: 0 });
  });
});

describe("la recharge elle-même", () => {
  it("transmet un HOLD du montant exact qui manque, et débloque le paiement", async () => {
    const { contract, jalon } = await createUnderfunded(120_000);
    await validateBeyondEscrow(contract.id, jalon.id);

    const rechargé = await requestRecharge(contract.id);
    expect(rechargé).toMatchObject({ ok: true, amount: 80_000 });
    if (!rechargé.ok) return;

    // Tant que le PSP n'a pas confirmé, rien n'est disponible de plus.
    expect((await escrowBalance(contract.id)).available).toBe(120_000);
    expect((await operateVirtualPsp("authorize", rechargé.operation.pspReference!)).ok).toBe(true);
    expect((await escrowBalance(contract.id)).available).toBe(JALON);

    // Le paiement passe désormais, sur le MÊME payable — jamais un doublon.
    const res = await emitScopedRelease({
      contractId: contract.id,
      jalonId: jalon.id,
      currency: "XOF",
      plafond: JALON,
      targetCumulative: JALON,
    });
    expect(res.ok).toBe(true);
    expect(await prisma.payable.count({ where: { sourceId: jalon.id } })).toBe(1);
  });

  it("refuse tant qu'un financement est EN VOL — jamais deux débits pour la même somme", async () => {
    const { contract, jalon } = await createUnderfunded(120_000);
    await validateBeyondEscrow(contract.id, jalon.id);

    expect((await requestRecharge(contract.id)).ok).toBe(true);
    // Le premier HOLD est `pending` : le client a peut-être déjà payé, le webhook n'est pas
    // arrivé. Lui en redemander un maintenant le ferait payer deux fois.
    expect(await requestRecharge(contract.id)).toMatchObject({
      ok: false,
      error: "hold_already_requested",
    });

    expect(
      await prisma.pspEscrowOperation.count({
        where: { contractId: contract.id, instructionType: "hold", status: "pending" },
      })
    ).toBe(1);
  });

  it("refuse quand il n'y a rien à recharger", async () => {
    const { contract } = await createUnderfunded(JALON);
    expect(await requestRecharge(contract.id)).toMatchObject({ ok: false, error: "nothing_to_recharge" });
  });

  it("refuse sur un contrat non signé des deux côtés", async () => {
    const { contract, jalon } = await createUnderfunded(120_000);
    await validateBeyondEscrow(contract.id, jalon.id);
    await prisma.prestationContract.update({
      where: { id: contract.id },
      data: { providerSignedAt: null },
    });
    expect(await requestRecharge(contract.id)).toMatchObject({ ok: false, error: "contract_not_signed" });
  });
});

describe("une recharge ne fait JAMAIS régresser la mission", () => {
  it("un livrable soumis le reste après confirmation du HOLD complémentaire", async () => {
    // Le défaut que la recharge a révélé : la branche `hold` du webhook écrivait
    // `fonds_sous_sequestre` SANS condition sur le chemin contrat. Un second HOLD ramenait donc
    // une mission déjà avancée en arrière — le client perdait le bouton de validation d'un
    // travail déjà rendu. La branche JALON portait cette garde ; pas la variante contrat.
    const { contract, jalon, mission } = await createUnderfunded(120_000, "livrable_soumis");
    await validateBeyondEscrow(contract.id, jalon.id);

    const rechargé = await requestRecharge(contract.id);
    if (!rechargé.ok) throw new Error("recharge attendue");
    expect((await operateVirtualPsp("authorize", rechargé.operation.pspReference!)).ok).toBe(true);

    const after = await prisma.mission.findUnique({ where: { id: mission.id } });
    expect(after?.status).toBe("livrable_soumis");
  });
});
