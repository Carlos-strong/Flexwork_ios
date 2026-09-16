/**
 * Compte financier du séquestre — « financer ≠ payer », rendu lisible (2026-09-14).
 *
 * La règle était appliquée par le moteur depuis la Phase 1, mais invisible : `escrowBalance`
 * n'était lu que par le module de recharge. Une règle qu'on ne peut pas constater n'est
 * appliquée qu'à moitié — ni le client ni le prestataire ne pouvaient vérifier que leur argent
 * la suit.
 *
 * Le scénario central reproduit l'exemple du cahier des charges (§16) au franc près.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { GET as balanceGet } from "@/app/api/missions/[id]/escrow/balance/route";
import { prisma } from "@/lib/db";
import { escrowBalance } from "@/lib/escrow";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-compte-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-compte-provider-${RUN}@flexwork.test`;
const TIERS_EMAIL = `e2e-compte-tiers-${RUN}@flexwork.test`;
const PRIX = 455_000;

let clientId = "";
let providerId = "";
let tiersId = "";
let missionId = "";
let contractId = "";
let jalonId = "";

const call = (userId: string | null) => {
  mockAuth.mockResolvedValue(userId ? { user: { id: userId } } : null);
  return balanceGet(new Request("http://localhost"), { params: Promise.resolve({ id: missionId }) });
};

const op = (data: Record<string, unknown>) =>
  prisma.pspEscrowOperation.create({
    data: {
      contractId,
      pspName: "psp-virtuelle",
      currency: "XOF",
      status: "confirmed",
      pspConfirmedAt: new Date(),
      ...data,
    } as never,
  });

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const [client, provider, tiers] = await Promise.all([
    prisma.user.create({
      data: { email: CLIENT_EMAIL, tel: `+229${RUN}60`, role: "client", status: "active", country: "BJ" },
    }),
    prisma.user.create({
      data: { email: PROVIDER_EMAIL, tel: `+229${RUN}61`, role: "expert_digital", status: "active", country: "BJ" },
    }),
    prisma.user.create({
      data: { email: TIERS_EMAIL, tel: `+229${RUN}62`, role: "client", status: "active", country: "BJ" },
    }),
  ]);
  clientId = client.id;
  providerId = provider.id;
  tiersId = tiers.id;

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Mission compte ${RUN}`,
      description: "Mission e2e pour le compte financier",
      domaine: "batiment",
      budget: PRIX,
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
      termsSnapshot: { prix: PRIX, devise: "XOF" },
      currentHash: `hash-compte-${RUN}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      jalons: { create: { ordre: 1, titre: "Jalon", montant: PRIX, status: "livrable_soumis" } },
    },
    include: { jalons: true },
  });
  contractId = contract.id;
  jalonId = contract.jalons[0].id;

  // L'exemple du §16, au franc près : financé 455 000, déjà libéré 180 000, litigieux 20 000.
  await op({ pspReference: `hold_compte_${RUN}`, amount: PRIX, instructionType: "hold" });
  await op({ pspReference: `rel_compte_${RUN}`, amount: 180_000, instructionType: "release", jalonId });
  await op({ pspReference: `frz_compte_${RUN}`, amount: 20_000, instructionType: "freeze" });
});

afterAll(async () => {
  await prisma.payable.deleteMany({ where: { contractId } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId } });
  await prisma.jalon.deleteMany({ where: { contractId } });
  await prisma.prestationContract.deleteMany({ where: { id: contractId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId, tiersId] } } });
});

describe("le compte financier reproduit l'exemple du cahier des charges", () => {
  it("les huit chiffres, au franc près", async () => {
    const b = await escrowBalance(contractId);
    expect(b).toMatchObject({
      contractual: PRIX,
      funded: PRIX,
      released: 180_000,
      refunded: 0,
      blocked: 20_000,
      available: 255_000,
    });
    // `held` est le chiffre que l'exemple laisse implicite : ce qui est PHYSIQUEMENT encore au
    // séquestre (275 000), distinct de ce qui peut bouger (255 000). Les confondre reviendrait
    // à dire au client que 20 000 ont disparu, alors qu'ils sont seulement immobilisés.
    expect(b.held).toBe(275_000);
    expect(b.held - b.blocked).toBe(b.available);
  });

  it("l'invariant comptable tient", async () => {
    const b = await escrowBalance(contractId);
    expect(b.funded).toBeCloseTo(b.released + b.refunded + b.held, 2);
  });
});

describe("financer ≠ payer : le montant reconnu dû est un chiffre à part", () => {
  it("un payable validé apparaît en `releasable`, jamais en `released`", async () => {
    const before = await escrowBalance(contractId);
    expect(before.releasable).toBe(0);

    // Une validation métier qui n'a pas encore produit d'instruction : le montant est DÛ,
    // il n'est pas PARTI.
    await prisma.payable.create({
      data: {
        contractId,
        missionId,
        sourceType: "jalon",
        sourceId: jalonId,
        amount: 75_000,
        currency: "XOF",
        status: "validated",
        idempotencyKey: `compte-${RUN}-1`,
      },
    });

    const after = await escrowBalance(contractId);
    expect(after.releasable).toBe(75_000);
    // Rien n'a bougé : ni ce qui est parti, ni ce qui reste, ni ce qui est disponible.
    expect(after.released).toBe(before.released);
    expect(after.held).toBe(before.held);
    expect(after.available).toBe(before.available);
  });

  it("un payable PAYÉ quitte `releasable` — il est passé dans `released`", async () => {
    await prisma.payable.updateMany({
      where: { contractId, status: "validated" },
      data: { status: "paid", paidAt: new Date() },
    });
    expect((await escrowBalance(contractId)).releasable).toBe(0);
  });
});

describe("décomposition du séquestre (§3)", () => {
  it("`held` se partitionne exactement en bloqué + retenu + disponible", async () => {
    const b = await escrowBalance(contractId);
    expect(b.blocked + b.retained + b.available).toBe(b.held);
  });

  it("le disponible se partitionne en « dû au prestataire » et « restituable au client »", async () => {
    const b = await escrowBalance(contractId);
    expect(b.owedToProvider + b.refundable).toBe(b.available);
  });

  it("un payable validé bascule du restituable vers le dû, sans rien déplacer", async () => {
    const avant = await escrowBalance(contractId);
    expect(avant.owedToProvider).toBe(0);
    expect(avant.refundable).toBe(avant.available);

    await prisma.payable.create({
      data: {
        contractId,
        missionId,
        sourceType: "jalon",
        sourceId: jalonId,
        amount: 55_000,
        currency: "XOF",
        status: "validated",
        idempotencyKey: `partition-${RUN}`,
      },
    });

    const apres = await escrowBalance(contractId);
    expect(apres.owedToProvider).toBe(55_000);
    expect(apres.refundable).toBe(avant.available - 55_000);
    // Aucun mouvement de fonds : la validation déplace une FRONTIÈRE, pas de l'argent.
    expect(apres.held).toBe(avant.held);
    expect(apres.released).toBe(avant.released);

    await prisma.payable.deleteMany({ where: { idempotencyKey: `partition-${RUN}` } });
  });

  it("un montant dû NON COUVERT ne gonfle pas le dû au-delà du disponible", async () => {
    // `releasable` peut dépasser `available` (§18, insuffisance). `owedToProvider` reste borné :
    // annoncer au prestataire plus que ce que le séquestre contient serait une promesse creuse.
    await prisma.payable.create({
      data: {
        contractId,
        missionId,
        sourceType: "jalon",
        sourceId: jalonId,
        amount: 900_000,
        currency: "XOF",
        status: "validated",
        idempotencyKey: `depassement-${RUN}`,
      },
    });

    const b = await escrowBalance(contractId);
    expect(b.releasable).toBe(900_000);
    expect(b.owedToProvider).toBe(b.available);
    expect(b.refundable).toBe(0);

    await prisma.payable.deleteMany({ where: { idempotencyKey: `depassement-${RUN}` } });
  });
});

describe("GET /api/missions/[id]/escrow/balance", () => {
  it("le CLIENT lit son compte", async () => {
    const res = await call(clientId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      role: "client",
      currency: "XOF",
      contractual: PRIX,
      available: 255_000,
      // L'état est DÉRIVÉ : une partie est partie, une autre reste.
      financialState: "partiellement_libere",
    });
  });

  it("le PRESTATAIRE lit le MÊME compte — le séquestre est commun", async () => {
    // Lui cacher ce qui lui est reconnu dû rendrait la distinction « validé ≠ payé »
    // inéquitable : elle ne protégerait que celui qui paie.
    const res = await call(providerId);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ role: "provider", contractual: PRIX, available: 255_000 });
  });

  it("un tiers reçoit 404, indistinguable d'une mission inexistante", async () => {
    expect((await call(tiersId)).status).toBe(404);
  });

  it("un visiteur non authentifié est refusé", async () => {
    expect((await call(null)).status).toBe(401);
  });
});
