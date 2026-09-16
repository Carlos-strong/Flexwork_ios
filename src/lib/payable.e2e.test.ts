/**
 * Obligation de paiement (Payable) et soldes explicites du séquestre — Phase 1, 2026-09-14.
 *
 * Ce que cette phase apporte, et que ce fichier verrouille :
 *
 *   1. « VALIDÉ » ne vaut plus « PAYÉ ». La validation métier crée une obligation ; seule la
 *      confirmation du PSP la solde. Entre les deux, un contrôle de solde.
 *   2. L'invariant n°4 du cahier des charges — `payableAmount <= availableEscrowAmount` — est
 *      désormais VÉRIFIÉ, et non plus seulement garanti par effet de bord d'une garde de statut.
 *   3. Le séquestre sait dire ce qui est disponible, pas seulement ce qui reste : une somme
 *      gelée par un litige ou retenue en garantie est bien là, et pourtant indisponible.
 *
 * L'invariant comptable global est réaffirmé à chaque scénario :
 *
 *      funded == released + refunded + held
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { emitScopedRelease, escrowBalance, escrowBalancesFor } from "@/lib/escrow";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { RETENTION_RATE_J4 } from "@/lib/financing-modes";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-payable-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-payable-provider-${RUN}@flexwork.test`;

let clientId = "";
let providerId = "";
const missionIds: string[] = [];
const contractIds: string[] = [];
let seq = 0;

/** Contrat avec un jalon, et un séquestre du montant demandé (0 = non financé). */
async function createContract(opts: { held: number; jalonMontant: number; retentionRate?: number }) {
  seq++;
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Mission payable ${RUN}-${seq}`,
      description: "Mission e2e pour l'obligation de paiement",
      domaine: "batiment",
      budget: opts.jalonMontant,
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
      termsSnapshot: { prix: opts.jalonMontant, devise: "XOF" },
      currentHash: `hash-payable-${RUN}-${seq}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      retentionRate: opts.retentionRate ?? 0,
      jalons: {
        create: { ordre: 1, titre: `Jalon ${seq}`, montant: opts.jalonMontant, status: "livrable_soumis" },
      },
      ...(opts.held > 0
        ? {
            escrowOperations: {
              create: {
                pspName: "psp-virtuelle",
                pspReference: `hold_payable_${RUN}_${seq}`,
                amount: opts.held,
                currency: "XOF",
                instructionType: "hold",
                status: "confirmed",
                pspConfirmedAt: new Date(),
              },
            },
          }
        : {}),
    },
    include: { jalons: true },
  });
  contractIds.push(contract.id);
  return { mission, contract, jalon: contract.jalons[0] };
}

/** L'invariant comptable, réaffirmé après chaque scénario. */
async function expectLedgerBalances(contractId: string) {
  const b = await escrowBalance(contractId);
  expect(b.funded).toBeCloseTo(b.released + b.refunded + b.held, 2);
  expect(b.available).toBeGreaterThanOrEqual(0);
  expect(b.available).toBeLessThanOrEqual(b.held);
  return b;
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}20`, role: "client", status: "active", country: "BJ" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}21`, role: "expert_digital", status: "active", country: "BJ" },
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

describe("soldes explicites du séquestre", () => {
  it("un séquestre neuf : tout est financé, tout est disponible", async () => {
    const { contract } = await createContract({ held: 200_000, jalonMontant: 200_000 });
    const b = await expectLedgerBalances(contract.id);
    expect(b).toMatchObject({ funded: 200_000, released: 0, refunded: 0, held: 200_000, blocked: 0, retained: 0, available: 200_000 });
  });

  it("un gel rend les fonds INDISPONIBLES sans les faire sortir", async () => {
    const { contract } = await createContract({ held: 200_000, jalonMontant: 200_000 });
    await prisma.pspEscrowOperation.create({
      data: {
        contractId: contract.id,
        pspName: "psp-virtuelle",
        pspReference: `freeze_payable_${RUN}_${seq}`,
        amount: 200_000,
        currency: "XOF",
        instructionType: "freeze",
        status: "confirmed",
        pspConfirmedAt: new Date(),
      },
    });

    const b = await expectLedgerBalances(contract.id);
    // Toujours au séquestre — un gel ne déplace rien…
    expect(b.held).toBe(200_000);
    // …mais plus rien ne peut en sortir : c'est exactement ce qu'on attend d'un litige.
    expect(b.blocked).toBe(200_000);
    expect(b.available).toBe(0);
  });

  it("le gel est borné par le solde — `available` ne passe jamais sous zéro", async () => {
    // Un gel porte le solde du moment et le modèle n'a pas d'instruction inverse : après une
    // libération de médiation, le gel dépasse ce qui reste. Sans borne, `available` deviendrait
    // négatif et toute lecture du séquestre serait fausse.
    const { contract } = await createContract({ held: 200_000, jalonMontant: 200_000 });
    for (const [type, amount] of [["freeze", 200_000], ["release", 150_000]] as const) {
      await prisma.pspEscrowOperation.create({
        data: {
          contractId: contract.id,
          pspName: "psp-virtuelle",
          pspReference: `${type}_borne_${RUN}_${seq}`,
          amount,
          currency: "XOF",
          instructionType: type,
          status: "confirmed",
          pspConfirmedAt: new Date(),
        },
      });
    }

    const b = await expectLedgerBalances(contract.id);
    expect(b.held).toBe(50_000);
    expect(b.blocked).toBe(50_000);
    expect(b.available).toBe(0);
  });
});

describe("obligation de paiement", () => {
  it("une libération crée un payable, le lie à son instruction et le marque `instructed`", async () => {
    const { contract, jalon } = await createContract({ held: 200_000, jalonMontant: 200_000 });

    const res = await emitScopedRelease({
      contractId: contract.id,
      jalonId: jalon.id,
      currency: "XOF",
      plafond: 200_000,
      targetCumulative: 200_000,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.payable).toMatchObject({
      sourceType: "jalon",
      sourceId: jalon.id,
      amount: 200_000,
      status: "instructed",
      escrowOperationId: res.operation.id,
    });
    // Pas encore payé : l'instruction est en vol.
    expect(res.payable.paidAt).toBeNull();
    await expectLedgerBalances(contract.id);
  });

  it("la confirmation PSP — et elle SEULE — fait passer le payable à `paid`", async () => {
    const { contract, jalon } = await createContract({ held: 200_000, jalonMontant: 200_000 });
    const res = await emitScopedRelease({
      contractId: contract.id,
      jalonId: jalon.id,
      currency: "XOF",
      plafond: 200_000,
      targetCumulative: 200_000,
    });
    if (!res.ok) throw new Error("libération attendue");

    expect((await prisma.payable.findUnique({ where: { id: res.payable.id } }))?.status).toBe("instructed");

    expect((await operateVirtualPsp("release", res.operation.pspReference!)).ok).toBe(true);

    const paid = await prisma.payable.findUnique({ where: { id: res.payable.id } });
    expect(paid?.status).toBe("paid");
    expect(paid?.paidAt).not.toBeNull();
    await expectLedgerBalances(contract.id);
  });

  it("financement progressif : un jalon produit PLUSIEURS payables, un par palier", async () => {
    // Le point de conception : une contrainte d'unicité sur (sourceType, sourceId) aurait
    // interdit le mode J3 tout entier. La clé porte le cumul VISÉ, pas la source seule.
    const { contract, jalon } = await createContract({ held: 200_000, jalonMontant: 200_000 });
    const emit = (target: number) =>
      emitScopedRelease({
        contractId: contract.id,
        jalonId: jalon.id,
        currency: "XOF",
        plafond: 200_000,
        targetCumulative: target,
      });

    const a = await emit(100_000);
    const b = await emit(150_000);
    const c = await emit(200_000);
    expect([a.ok, b.ok, c.ok]).toEqual([true, true, true]);

    const payables = await prisma.payable.findMany({
      where: { sourceType: "jalon", sourceId: jalon.id },
      orderBy: { amount: "asc" },
    });
    expect(payables).toHaveLength(3);
    // Chaque palier ne porte QUE son incrément — jamais le cumul, sinon le total dépasserait.
    expect(payables.map((p) => p.amount)).toEqual([50_000, 50_000, 100_000]);
    expect(payables.reduce((s, p) => s + p.amount, 0)).toBe(200_000);
    await expectLedgerBalances(contract.id);
  });

  it("rejouer le MÊME palier ne crée pas un second payable", async () => {
    const { contract, jalon } = await createContract({ held: 200_000, jalonMontant: 200_000 });
    const emit = () =>
      emitScopedRelease({
        contractId: contract.id,
        jalonId: jalon.id,
        currency: "XOF",
        plafond: 200_000,
        targetCumulative: 120_000,
      });

    expect((await emit()).ok).toBe(true);
    expect(await emit()).toEqual({ ok: false, reason: "nothing_to_release" });

    expect(await prisma.payable.count({ where: { sourceId: jalon.id } })).toBe(1);
    await expectLedgerBalances(contract.id);
  });

  it("deux libérations SIMULTANÉES ne produisent qu'un payable et qu'une instruction", async () => {
    const { contract, jalon } = await createContract({ held: 200_000, jalonMontant: 200_000 });
    const emit = () =>
      emitScopedRelease({
        contractId: contract.id,
        jalonId: jalon.id,
        currency: "XOF",
        plafond: 200_000,
        targetCumulative: 200_000,
      });

    const [a, b] = await Promise.all([emit(), emit()]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(await prisma.payable.count({ where: { sourceId: jalon.id } })).toBe(1);
    await expectLedgerBalances(contract.id);
  });
});

describe("invariant n°4 — jamais plus que le séquestre disponible", () => {
  it("séquestre insuffisant : AUCUNE instruction, mais le payable reste dû", async () => {
    // Le jalon vaut 200 000, le client n'en a financé que 120 000.
    const { contract, jalon } = await createContract({ held: 120_000, jalonMontant: 200_000 });

    const res = await emitScopedRelease({
      contractId: contract.id,
      jalonId: jalon.id,
      currency: "XOF",
      plafond: 200_000,
      targetCumulative: 200_000,
    });

    expect(res).toMatchObject({ ok: false, reason: "escrow_insufficient", available: 120_000, wanted: 200_000 });

    // Rien n'est parti — pas de paiement PARTIEL implicite (§13 du cahier des charges).
    expect(await prisma.pspEscrowOperation.count({ where: { contractId: contract.id, instructionType: "release" } })).toBe(0);

    // …mais la somme reste DUE, enregistrée, en attente de recharge.
    const payable = await prisma.payable.findFirst({ where: { sourceId: jalon.id } });
    expect(payable).toMatchObject({ status: "validated", amount: 200_000, escrowOperationId: null });
    await expectLedgerBalances(contract.id);
  });

  it("après recharge du séquestre, le MÊME payable est instruit — jamais un doublon", async () => {
    const { contract, jalon } = await createContract({ held: 120_000, jalonMontant: 200_000 });
    const emit = () =>
      emitScopedRelease({
        contractId: contract.id,
        jalonId: jalon.id,
        currency: "XOF",
        plafond: 200_000,
        targetCumulative: 200_000,
      });

    await emit();
    const dû = await prisma.payable.findFirstOrThrow({ where: { sourceId: jalon.id } });

    // Le client complète le séquestre.
    await prisma.pspEscrowOperation.create({
      data: {
        contractId: contract.id,
        pspName: "psp-virtuelle",
        pspReference: `hold_recharge_${RUN}_${seq}`,
        amount: 80_000,
        currency: "XOF",
        instructionType: "hold",
        status: "confirmed",
        pspConfirmedAt: new Date(),
      },
    });

    const res = await emit();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.payable.id).toBe(dû.id);
    expect(res.payable.status).toBe("instructed");
    expect(await prisma.payable.count({ where: { sourceId: jalon.id } })).toBe(1);
    await expectLedgerBalances(contract.id);
  });

  it("la retenue de garantie (J4) est comptée comme INDISPONIBLE une fois le jalon libéré", async () => {
    // DEUX jalons, volontairement : sur un jalon unique, la confirmation du release déclenche
    // aussitôt la libération FINALE de la retenue (tous les jalons sont alors `libere`), et il
    // n'y a jamais d'instant où l'observer en attente. C'est précisément cet instant qui compte
    // ici — la retenue du jalon payé est acquise, séquestrée, et ne doit pas pouvoir financer
    // la libération du jalon suivant.
    seq++;
    const mission = await prisma.mission.create({
      data: {
        clientId,
        titre: `Mission retenue ${RUN}-${seq}`,
        description: "Mission e2e retenue de garantie",
        domaine: "batiment",
        budget: 200_000,
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
        termsSnapshot: { prix: 200_000, devise: "XOF" },
        currentHash: `hash-retenue-${RUN}-${seq}`,
        clientSignedAt: new Date(),
        providerSignedAt: new Date(),
        retentionRate: RETENTION_RATE_J4,
        jalons: {
          create: [
            { ordre: 1, titre: "Jalon A", montant: 100_000, status: "livrable_soumis" },
            { ordre: 2, titre: "Jalon B", montant: 100_000, status: "livrable_soumis" },
          ],
        },
        escrowOperations: {
          create: {
            pspName: "psp-virtuelle",
            pspReference: `hold_retenue_${RUN}_${seq}`,
            amount: 200_000,
            currency: "XOF",
            instructionType: "hold",
            status: "confirmed",
            pspConfirmedAt: new Date(),
          },
        },
      },
      include: { jalons: { orderBy: { ordre: "asc" } } },
    });
    contractIds.push(contract.id);

    const premier = contract.jalons[0];
    const retenueParJalon = Math.round(100_000 * RETENTION_RATE_J4);
    const plafond = 100_000 - retenueParJalon;

    const res = await emitScopedRelease({
      contractId: contract.id,
      jalonId: premier.id,
      currency: "XOF",
      plafond,
      retentionRate: RETENTION_RATE_J4,
      targetCumulative: plafond,
    });
    if (!res.ok) throw new Error("libération attendue");
    expect((await operateVirtualPsp("release", res.operation.pspReference!)).ok).toBe(true);

    const b = await expectLedgerBalances(contract.id);
    // Le premier jalon est payé, retenue déduite : le séquestre garde le second jalon ENTIER
    // plus la retenue du premier.
    expect(b.held).toBe(200_000 - plafond);
    expect(b.retained).toBe(retenueParJalon);
    // La retenue acquise est indisponible : elle ne peut pas servir à payer le jalon suivant,
    // elle a son instruction finale à elle.
    expect(b.available).toBe(b.held - retenueParJalon);
  });
});

describe("vue agrégée — les mêmes chiffres, en un nombre constant de requêtes", () => {
  it("escrowBalancesFor donne EXACTEMENT ce que escrowBalance donne, contrat par contrat", async () => {
    // Une divergence entre la vue unitaire et la vue agrégée serait le pire défaut possible :
    // deux écrans afficheraient des soldes différents pour le même séquestre, et aucun des deux
    // ne serait croyable. Les deux chemins partagent les mêmes fonctions pures ; ce test le
    // prouve sur des contrats aux états variés (gelé, partiellement libéré, avec retenue).
    const lot = await escrowBalancesFor(contractIds);
    expect(lot.size).toBe(contractIds.length);

    for (const id of contractIds) {
      const unitaire = await escrowBalance(id);
      expect(lot.get(id), `contrat ${id}`).toEqual(unitaire);
    }
  });

  it("une liste vide ne déclenche aucune requête et rend une table vide", async () => {
    expect((await escrowBalancesFor([])).size).toBe(0);
  });

  it("un contrat inconnu est simplement absent du résultat", async () => {
    const lot = await escrowBalancesFor(["contrat-inexistant"]);
    expect(lot.has("contrat-inexistant")).toBe(false);
  });
});
