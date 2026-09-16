/**
 * Test E2E du chemin MONÉTAIRE d'une commande Gig (2026-09-14).
 *
 * Ce que ce fichier verrouille : jusqu'à ce correctif, le domaine Gig n'avait AUCUNE sortie de
 * séquestre vers le prestataire. L'argent entrait (`hold` à la signature du client) et ne
 * pouvait que revenir au client (`refund`, annulation des 24h) — aucune instruction `release`
 * n'existait, et `GigOrderStatus.completed` n'était écrit nulle part. Un Gig livré laissait donc
 * les fonds immobilisés pour toujours.
 *
 * L'invariant vérifié est le même que celui des missions : sur la vie d'une commande, ce qui
 * sort vaut exactement ce qui est entré, et le solde retombe à zéro. S'y ajoutent les deux
 * gardes qui empêchent l'argent de sortir deux fois ou de sortir trop tôt.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "@/lib/db";
import { completeGigOrder, gigHeldBalance, gigAvailableBalance } from "@/lib/gig-completion";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-gig-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-gig-provider-${RUN}@flexwork.test`;
const MONTANT = 150_000;

let clientId = "";
let providerId = "";
let gigId = "";
const createdOrderIds: string[] = [];

// Commande engagée (`active`) avec ses fonds déjà séquestrés : l'état exact dans lequel une
// livraison peut être validée. Reproduit ce que fait la route de signature 1/2 puis 2/2, sans
// dérouler le parcours de certificat qui n'est pas le sujet de ce test.
async function createFundedOrder(status: "active" | "client_signed" = "active") {
  const order = await prisma.gigOrder.create({
    data: {
      gigId,
      clientId,
      providerId,
      montant: MONTANT,
      currency: "XOF",
      termsSnapshot: { prix: MONTANT, currency: "XOF" },
      status,
      clientSignedAt: new Date(),
      providerSignedAt: status === "active" ? new Date() : null,
      escrowOperations: {
        create: {
          sourceType: "gig_order",
          pspName: "gig-hold",
          amount: MONTANT,
          currency: "XOF",
          instructionType: "hold",
          status: "confirmed",
          pspConfirmedAt: new Date(),
        },
      },
    },
  });
  createdOrderIds.push(order.id);
  return order;
}

beforeAll(async () => {
  const client = await prisma.user.create({
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}1`, role: "client", status: "active", country: "BJ" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}2`, role: "expert_digital", status: "active", country: "BJ" },
  });
  clientId = client.id;
  providerId = provider.id;

  const gig = await prisma.gig.create({
    data: {
      providerId,
      titre: `Gig e2e ${RUN}`,
      description: "Installation électrique complète",
      domaine: "batiment",
      prix: MONTANT,
      currency: "XOF",
      delaiJours: 7,
      status: "publie",
    },
  });
  gigId = gig.id;
});

afterAll(async () => {
  await prisma.pspEscrowOperation.deleteMany({ where: { orderId: { in: createdOrderIds } } });
  await prisma.gigOrder.deleteMany({ where: { id: { in: createdOrderIds } } });
  await prisma.gig.deleteMany({ where: { id: gigId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("paiement d'une commande Gig", () => {
  it("une commande financée porte bien son montant au séquestre", async () => {
    const order = await createFundedOrder();
    expect(await gigHeldBalance(order.id)).toBe(MONTANT);
  });

  it("la validation libère TOUT le séquestre au prestataire et clôt la commande", async () => {
    const order = await createFundedOrder();

    const result = await completeGigOrder(order.id);
    expect(result).toEqual({ ok: true, amount: MONTANT, currency: "XOF" });

    const after = await prisma.gigOrder.findUnique({
      where: { id: order.id },
      select: { status: true },
    });
    expect(after?.status).toBe("completed");

    // L'invariant : le séquestre est vidé, ni plus ni moins.
    expect(await gigHeldBalance(order.id)).toBe(0);

    const releases = await prisma.pspEscrowOperation.findMany({
      where: { orderId: order.id, instructionType: "release" },
      select: { amount: true, status: true },
    });
    expect(releases).toHaveLength(1);
    expect(releases[0]).toEqual({ amount: MONTANT, status: "confirmed" });
  });

  it("une seconde validation n'instruit RIEN — pas de double paiement", async () => {
    const order = await createFundedOrder();
    await completeGigOrder(order.id);

    const second = await completeGigOrder(order.id);
    expect(second).toEqual({ ok: false, error: "order_not_active" });

    const releases = await prisma.pspEscrowOperation.count({
      where: { orderId: order.id, instructionType: "release" },
    });
    expect(releases).toBe(1);
  });

  it("deux validations SIMULTANÉES ne libèrent qu'une fois — le verrou tient", async () => {
    const order = await createFundedOrder();

    const [a, b] = await Promise.all([completeGigOrder(order.id), completeGigOrder(order.id)]);
    const succeeded = [a, b].filter((r) => r.ok);
    expect(succeeded).toHaveLength(1);

    const releases = await prisma.pspEscrowOperation.findMany({
      where: { orderId: order.id, instructionType: "release" },
      select: { amount: true },
    });
    expect(releases).toHaveLength(1);
    expect(await gigHeldBalance(order.id)).toBe(0);
  });

  it("une commande non engagée ne peut pas être payée — le prestataire n'a pas signé", async () => {
    const order = await createFundedOrder("client_signed");
    expect(await completeGigOrder(order.id)).toEqual({ ok: false, error: "order_not_active" });
    expect(await gigHeldBalance(order.id)).toBe(MONTANT);
  });

  it("une commande inconnue est refusée sans rien écrire", async () => {
    expect(await completeGigOrder("gig-order-inexistante")).toEqual({ ok: false, error: "not_found" });
  });

  it("une commande engagée mais déjà vidée de son séquestre n'instruit rien", async () => {
    const order = await createFundedOrder();
    // Un remboursement antérieur a fait sortir les fonds : le solde est nul, il n'y a plus rien
    // à libérer — et c'est le SOLDE qui le dit, pas `order.montant`.
    await prisma.pspEscrowOperation.create({
      data: {
        sourceType: "gig_order",
        orderId: order.id,
        pspName: "gig-24h-refund",
        amount: MONTANT,
        currency: "XOF",
        instructionType: "refund",
        status: "confirmed",
        pspConfirmedAt: new Date(),
      },
    });
    expect(await gigHeldBalance(order.id)).toBe(0);
    expect(await completeGigOrder(order.id)).toEqual({ ok: false, error: "nothing_to_release" });
  });
});

describe("obligation de paiement — le domaine Gig sur la machinerie de la Phase 1", () => {
  it("la validation crée un PAYABLE, le lie à son instruction et le solde", async () => {
    // Avant ce raccordement (2026-09-14), ce chemin émettait directement l'instruction : le
    // registre était unifié (0.1) mais la couche obligation ne l'était pas, et « validé ≠ payé »
    // n'existait que du côté mission.
    const order = await createFundedOrder();
    expect(await completeGigOrder(order.id)).toMatchObject({ ok: true, amount: MONTANT });

    const payables = await prisma.payable.findMany({ where: { sourceId: order.id } });
    expect(payables).toHaveLength(1);
    expect(payables[0]).toMatchObject({
      sourceType: "gig_order",
      sourceId: order.id,
      amount: MONTANT,
      status: "paid",
      // Une commande Gig n'a pas de contrat de prestation : c'est le cas pour lequel l'identité
      // d'un payable a été fondée sur sa SOURCE, et la clé étrangère laissée nullable.
      contractId: null,
    });
    expect(payables[0].escrowOperationId).not.toBeNull();
    expect(payables[0].paidAt).not.toBeNull();
  });

  it("une seconde validation ne crée PAS un second payable", async () => {
    const order = await createFundedOrder();
    await completeGigOrder(order.id);
    await completeGigOrder(order.id);
    expect(await prisma.payable.count({ where: { sourceId: order.id } })).toBe(1);
  });

  it("deux validations SIMULTANÉES ne produisent qu'un payable", async () => {
    const order = await createFundedOrder();
    await Promise.all([completeGigOrder(order.id), completeGigOrder(order.id)]);
    expect(await prisma.payable.count({ where: { sourceId: order.id } })).toBe(1);
  });

  it("invariant n°4 : un séquestre insuffisant n'instruit RIEN et laisse la créance due", async () => {
    const order = await createFundedOrder();
    // Un remboursement partiel a fait sortir une partie des fonds : le séquestre ne couvre plus
    // le montant de la commande.
    await prisma.pspEscrowOperation.create({
      data: {
        sourceType: "gig_order",
        orderId: order.id,
        pspName: "gig-24h-refund",
        amount: 60_000,
        currency: "XOF",
        instructionType: "refund",
        status: "confirmed",
        pspConfirmedAt: new Date(),
      },
    });

    expect(await completeGigOrder(order.id)).toEqual({ ok: false, error: "escrow_insufficient" });

    // Aucun versement partiel implicite (§13)…
    expect(
      await prisma.pspEscrowOperation.count({
        where: { orderId: order.id, instructionType: "release" },
      })
    ).toBe(0);
    // …et la créance reste DUE.
    const payable = await prisma.payable.findFirstOrThrow({ where: { sourceId: order.id } });
    expect(payable).toMatchObject({ status: "validated", amount: MONTANT, escrowOperationId: null });
    // La commande n'est pas clôturée : rien n'a été réglé.
    expect((await prisma.gigOrder.findUnique({ where: { id: order.id } }))?.status).toBe("active");
  });

  it("le solde DISPONIBLE est distinct du solde détenu, et un gel l'annule", async () => {
    const order = await createFundedOrder();
    expect(await gigAvailableBalance(order.id)).toBe(MONTANT);

    await prisma.pspEscrowOperation.create({
      data: {
        sourceType: "gig_order",
        orderId: order.id,
        pspName: "gig-freeze",
        amount: MONTANT,
        currency: "XOF",
        instructionType: "freeze",
        status: "confirmed",
        pspConfirmedAt: new Date(),
      },
    });

    // Les fonds sont toujours là — un gel ne déplace rien — mais plus rien ne peut sortir.
    expect(await gigHeldBalance(order.id)).toBe(MONTANT);
    expect(await gigAvailableBalance(order.id)).toBe(0);
    expect(await completeGigOrder(order.id)).toEqual({ ok: false, error: "nothing_to_release" });
  });
});
