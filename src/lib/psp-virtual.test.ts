/**
 * Tests de la PSP virtuelle (2026-08-31) — simulation du prestataire de paiement agréé pour
 * tester le cycle séquestre de bout en bout en développement :
 *
 * 1. La confirmation d'un mouvement passe TOUJOURS par le chemin webhook signé (US-503) :
 *    `operateVirtualPsp`/`autoConfirmPending` renvoient un webhook signé HMAC consommé par
 *    `applyPspWebhookEvent` — jamais une mise à jour optimiste côté plateforme.
 * 2. Gardes de cohérence : référence inconnue, opération déjà traitée, action incohérente
 *    avec l'instruction (authorize ≠ release) sont refusées.
 * 3. Le mode autoconfirm (ESCROW_STUB_AUTOCONFIRM=true) confirme immédiatement les
 *    instructions créées par `requestContractHold`.
 * 4. La console (`getVirtualPspSnapshot`) dérive les soldes séquestrés des confirmations.
 *
 * Même pattern que escrow.test.ts : création de vrais utilisateurs/mission/contrat en base,
 * puis vérification de l'état via Prisma.
 */

import { describe, expect, it, beforeAll, afterAll } from "vitest";

import { prisma } from "@/lib/db";
import { requestContractHold } from "@/lib/escrow";
import {
  isVirtualPspEnabled,
  shouldAutoConfirmStub,
  operateVirtualPsp,
  autoConfirmPending,
  getVirtualPspSnapshot,
  eventForInstruction,
} from "@/lib/psp-virtual";

const RUN = Date.now();
let clientId: string;
let providerId: string;
let missionId: string;
let contractId: string;

async function cleanup() {
  await prisma.contractAuditEntry.deleteMany({ where: { contract: { missionId } } });
  await prisma.contractSignature.deleteMany({ where: { contract: { missionId } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contract: { missionId } } });
  await prisma.prestationContract.deleteMany({ where: { missionId } });
  await prisma.missionProposal.deleteMany({ where: { missionId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
}

beforeAll(async () => {
  // Déterministe : le PSP virtuel est actif dès que NODE_ENV ≠ production et que
  // NEXT_PUBLIC_APP_ENV n'est pas "production". On fige le mode console (sans stub).
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: {
      email: `pspvirt-client-${RUN}@flexwork.test`,
      tel: `+229${RUN}3`,
      role: "client",
      status: "active",
      country: "BJ",
    },
  });
  const provider = await prisma.user.create({
    data: {
      email: `pspvirt-provider-${RUN}@flexwork.test`,
      tel: `+229${RUN}4`,
      role: "artisan",
      status: "active",
      country: "BJ",
    },
  });
  clientId = client.id;
  providerId = provider.id;

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `PSP_VIRT_${RUN}`,
      description: "Mission de test de la PSP virtuelle",
      domaine: "plomberie",
      budget: 75000,
      currency: "XOF",
      delaiJours: 30,
      riskLevel: "low",
      status: "proposition_acceptee",
    },
  });
  missionId = mission.id;
  await prisma.missionProposal.create({
    data: { missionId, providerId, montant: 75000, message: "Candidature acceptée", status: "acceptee" },
  });

  const contract = await prisma.prestationContract.create({
    data: {
      missionId,
      clientId,
      providerId,
      currentHash: `psp-virt-${RUN}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      termsSnapshot: { prix: 75000, devise: "XOF", objet: "Test PSP virtuelle", delaiJours: 30 },
    },
  });
  contractId = contract.id;

  // upsert (pas create) : escrow.test.ts crée le même flag et les fichiers tournent en
  // parallèle (process séparés, base partagée) — un create concurrent lèverait une
  // violation d'unicité. deleteMany en teardown est idempotent.
  await prisma.featureFlag.upsert({
    where: { key_zone: { key: "psp_montage_valide", zone: "BJ" } },
    update: { enabled: true },
    create: { key: "psp_montage_valide", zone: "BJ", enabled: true },
  });
});

afterAll(async () => {
  await cleanup();
  // ⚠️ PAS de suppression du flag psp_montage_valide (fixture partagé, voir escrow.test.ts).
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
  delete process.env.ESCROW_STUB_AUTOCONFIRM;
});

describe("PSP virtuelle (2026-08-31)", () => {
  it("est active en développement, jamais en production", () => {
    expect(isVirtualPspEnabled()).toBe(true);
    const previous = process.env.NODE_ENV;
    // Vitest fige NODE_ENV à "test" — impossible de le passer à "production" à chaud dans
    // tous les cas ; on vérifie au moins la règle : app_env production désactive le PSP.
    process.env.NEXT_PUBLIC_APP_ENV = "production";
    expect(isVirtualPspEnabled()).toBe(false);
    process.env.NEXT_PUBLIC_APP_ENV = "development";
    expect(previous).toBe("test"); // cohérence de l'environnement de test
  });

  it("mappe chaque instruction à son évènement de confirmation", () => {
    expect(eventForInstruction("hold")).toBe("hold_confirmed");
    expect(eventForInstruction("release")).toBe("release_confirmed");
    expect(eventForInstruction("freeze")).toBe("freeze_confirmed");
    expect(eventForInstruction("refund")).toBe("refund_confirmed");
    expect(eventForInstruction("inconnu")).toBe("failed");
  });

  it("authorize confirme un HOLD via webhook signé et fait passer la mission sous séquestre", async () => {
    const created = await requestContractHold(contractId);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    // Mode console : l'opération est créée `pending` (pas de stub actif).
    expect(created.operation.status).toBe("pending");
    expect(created.operation.pspName).toBe("psp-virtuelle");
    const reference = created.operation.pspReference!;

    const result = await operateVirtualPsp("authorize", reference);
    expect(result.ok).toBe(true);

    const op = await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { pspReference: reference } });
    expect(op.status).toBe("confirmed");
    expect(op.pspConfirmedAt).not.toBeNull();
    expect(op.webhookReference).toBe("hold_confirmed");

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("fonds_sous_sequestre");
  });

  it("refuse une opération déjà traitée (non pending)", async () => {
    const holdOp = await prisma.pspEscrowOperation.findFirstOrThrow({
      where: { contractId, instructionType: "hold" },
    });
    const result = await operateVirtualPsp("authorize", holdOp.pspReference!);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("operation_not_pending");
  });

  it("refuse une référence inconnue et une action incohérente avec l'instruction", async () => {
    const missing = await operateVirtualPsp("authorize", "hold_inexistante");
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toBe("operation_not_found");

    // Une RELEASE ne peut pas être « autorisée » comme un paiement client — miroir du PSP réel.
    const release = await prisma.pspEscrowOperation.create({
      data: {
        contractId,
        pspName: "psp-virtuelle",
        pspReference: `release_${RUN}_mismatch`,
        amount: 75000,
        currency: "XOF",
        instructionType: "release",
      },
    });
    const mismatch = await operateVirtualPsp("authorize", release.pspReference!);
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) expect(mismatch.error).toBe("instruction_mismatch");

    // « fail » reste permis sur n'importe quelle instruction.
    const failed = await operateVirtualPsp("fail", release.pspReference!);
    expect(failed.ok).toBe(true);
    const op = await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: release.id } });
    expect(op.status).toBe("failed");
  });

  it("release confirme une libération et clôture directement la mission (contrat sans jalon)", async () => {
    // Corrigé le 2026-09-02 (audit workflow) : le webhook posait auparavant "validee", un cul-
    // de-sac — aucun autre code n'écrivait "cloturee" pour un contrat sans jalon, la mission y
    // restait bloquée indéfiniment et le lien "Donner un avis" (gaté sur "cloturee") n'était
    // jamais atteignable. Même symétrie que la branche jalons : un seul RELEASE ici, donc
    // aucune condition de complétion à attendre contrairement au cas multi-jalons.
    await prisma.mission.update({ where: { id: missionId }, data: { status: "livrable_soumis" } });
    const release = await prisma.pspEscrowOperation.create({
      data: {
        contractId,
        pspName: "psp-virtuelle",
        pspReference: `release_${RUN}`,
        amount: 75000,
        currency: "XOF",
        instructionType: "release",
      },
    });
    const result = await operateVirtualPsp("release", release.pspReference!);
    expect(result.ok).toBe(true);

    const op = await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: release.id } });
    expect(op.status).toBe("confirmed");
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("cloturee");
  });

  it("le mode autoconfirm confirme immédiatement le HOLD de requestContractHold", async () => {
    process.env.ESCROW_STUB_AUTOCONFIRM = "true";
    expect(shouldAutoConfirmStub()).toBe(true);

    // Nouvelle mission + contrat pour isoler ce scénario (la mission précédente est validee).
    const mission2 = await prisma.mission.create({
      data: {
        clientId,
        titre: `PSP_VIRT_AUTO_${RUN}`,
        description: "Test autoconfirm",
        domaine: "plomberie",
        budget: 30000,
        currency: "XOF",
        delaiJours: 30,
        riskLevel: "low",
        status: "proposition_acceptee",
      },
    });
    const contract2 = await prisma.prestationContract.create({
      data: {
        missionId: mission2.id,
        clientId,
        providerId,
        currentHash: `psp-virt-auto-${RUN}`,
        clientSignedAt: new Date(),
        providerSignedAt: new Date(),
        termsSnapshot: { prix: 30000, devise: "XOF", objet: "Autoconfirm", delaiJours: 30 },
      },
    });

    const created = await requestContractHold(contract2.id);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    // Le HOLD est déjà confirmé par la PSP virtuelle (stub) → statut reflété dans la réponse.
    expect(created.operation.status).toBe("confirmed");

    const op = await prisma.pspEscrowOperation.findFirstOrThrow({
      where: { contractId: contract2.id, instructionType: "hold" },
    });
    expect(op.status).toBe("confirmed");

    const mission2b = await prisma.mission.findUniqueOrThrow({ where: { id: mission2.id } });
    expect(mission2b.status).toBe("fonds_sous_sequestre");

    await prisma.contractAuditEntry.deleteMany({ where: { contract: { missionId: mission2.id } } });
    await prisma.contractSignature.deleteMany({ where: { contract: { missionId: mission2.id } } });
    await prisma.pspEscrowOperation.deleteMany({ where: { contract: { missionId: mission2.id } } });
    await prisma.prestationContract.deleteMany({ where: { missionId: mission2.id } });
    await prisma.mission.deleteMany({ where: { id: mission2.id } });
  });

  it("la console dérive les soldes séquestrés des opérations confirmées", async () => {
    const snapshot = await getVirtualPspSnapshot();
    expect(snapshot.enabled).toBe(true);
    expect(snapshot.pspName).toBe("psp-virtuelle");
    // Au moins une opération (le HOLD confirmé du test principal).
    expect(snapshot.operations.length).toBeGreaterThan(0);
    // Le solde du contrat reflète : HOLD 75 000 confirmé − RELEASE 75 000 confirmé = 0.
    const held = snapshot.held.find((h) => h.contractId === contractId);
    if (held) expect(held.amount).toBe(0);
  });
});
