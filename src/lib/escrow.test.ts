/**
 * Tests de non-régression des 3 corrections du workflow mission (2026-08-30) :
 *
 * 1. Contre-proposition complète : `delaiPropose` (délai proposé par le prestataire) doit
 *    être repris dans le contrat (termsSnapshot.delaiJours + clauseDuree), avec fallback sur
 *    mission.delaiJours quand absent.
 * 2. Montant du séquestre : le HOLD/RELEASE porte sur le PRIX du contrat
 *    (termsSnapshot.prix = montant de la proposition acceptée), pas sur le budget publié.
 * 3. Déclenchement automatique : `requestContractHold` est la source unique du HOLD global
 *    (garde-fous + montant), utilisée à la fois par la route manuelle et par la contre-signature.
 *
 * Même pattern que contract-signature-workflow.test.ts : appel des vrais route handlers avec
 * mock de `auth()`, puis vérification de l'état en base (Prisma).
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as contractPost } from "@/app/api/missions/[id]/contract/route";
import { contractPrice, requestContractHold } from "@/lib/escrow";
import { prisma } from "@/lib/db";

const RUN = Date.now();
let clientId: string;
let providerId: string;
let missionId: string;
let fallbackMissionId: string;

function authAs(userId: string) {
  mockAuth.mockResolvedValue({
    user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur", role: "client" },
  });
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function cleanupMission(id: string) {
  await prisma.contractAuditEntry.deleteMany({ where: { contract: { missionId: id } } });
  await prisma.contractSignature.deleteMany({ where: { contract: { missionId: id } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contract: { missionId: id } } });
  await prisma.prestationContract.deleteMany({ where: { missionId: id } });
  await prisma.missionProposal.deleteMany({ where: { missionId: id } });
  await prisma.mission.deleteMany({ where: { id } });
}

beforeAll(async () => {
  const client = await prisma.user.create({
    data: {
      email: `escrow-client-${RUN}@flexwork.test`,
      tel: `+229${RUN}1`,
      role: "client",
      status: "active",
      country: "BJ",
    },
  });
  const provider = await prisma.user.create({
    data: {
      email: `escrow-provider-${RUN}@flexwork.test`,
      tel: `+229${RUN}2`,
      role: "artisan",
      status: "active",
      country: "BJ",
    },
  });
  clientId = client.id;
  providerId = provider.id;

  // Mission principale : le prestataire a proposé un délai DIFFÉRENT (45 vs 30) et un prix
  // DIFFÉRENT (120 000 vs budget publié 100 000) — le contrat doit porter SA contre-proposition.
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `ESCROW_FLOW_${RUN}`,
      description: "Mission de test du workflow séquestre",
      domaine: "plomberie",
      budget: 100000,
      currency: "XOF",
      delaiJours: 30,
      riskLevel: "low",
      status: "proposition_acceptee",
    },
  });
  missionId = mission.id;
  await prisma.missionProposal.create({
    data: {
      missionId,
      providerId,
      montant: 120000,
      delaiPropose: 45,
      message: "Contre-proposition complète (prix + délai)",
      status: "acceptee",
    },
  });

  // Mission de contrôle : candidature SANS delaiPropose → le contrat doit retomber sur
  // mission.delaiJours (30).
  const fallback = await prisma.mission.create({
    data: {
      clientId,
      titre: `ESCROW_FALLBACK_${RUN}`,
      description: "Mission de contrôle du fallback de délai",
      domaine: "plomberie",
      budget: 100000,
      currency: "XOF",
      delaiJours: 30,
      riskLevel: "low",
      status: "proposition_acceptee",
    },
  });
  fallbackMissionId = fallback.id;
  await prisma.missionProposal.create({
    data: {
      missionId: fallbackMissionId,
      providerId,
      montant: 90000,
      message: "Candidature sans délai proposé",
      status: "acceptee",
    },
  });

  // Permet au HOLD de passer les garde-fous (par défaut le flag est désactivé). upsert (pas
  // create) : psp-virtual.test.ts crée le même flag et les fichiers tournent en parallèle
  // (process séparés, base partagée) — un create concurrent lèverait une violation d'unicité.
  await prisma.featureFlag.upsert({
    where: { key_zone: { key: "psp_montage_valide", zone: "BJ" } },
    update: { enabled: true },
    create: { key: "psp_montage_valide", zone: "BJ", enabled: true },
  });
});

afterAll(async () => {
  await cleanupMission(missionId);
  await cleanupMission(fallbackMissionId);
  // ⚠️ PAS de suppression du flag psp_montage_valide : c'est un fixture partagé (upsert en
  // beforeAll) utilisé par plusieurs fichiers qui tournent en parallèle sur la base partagée
  // (escrow.test.ts, psp-virtual.test.ts, mission-lifecycle.e2e.test.ts). Le supprimer ici
  // pendant qu'un autre fichier exécute requestContractHold casse ses voisins (psp_not_enabled).
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("Corrections workflow mission (2026-08-30)", () => {
  it("contractPrice utilise le prix du contrat (termsSnapshot.prix), pas le budget publié", () => {
    expect(
      contractPrice({ mission: { budget: 100000 }, termsSnapshot: { prix: 120000, devise: "XOF" } })
    ).toBe(120000);
    // Contrat ancien sans `prix` dans le snapshot → fallback sur le budget publié.
    expect(
      contractPrice({ mission: { budget: 100000 }, termsSnapshot: { objet: "ancien" } })
    ).toBe(100000);
  });

  it("le contrat reprend le delaiPropose de la contre-proposition (délai + prix)", async () => {
    authAs(clientId);
    const res = await contractPost(postReq({}), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);

    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { missionId },
    });
    const snap = contract.termsSnapshot as {
      prix: number;
      delaiJours: number;
      clauseDuree: string;
    };
    expect(snap.prix).toBe(120000);
    expect(snap.delaiJours).toBe(45);
    expect(snap.clauseDuree).toContain("45 jours");
  });

  it("sans delaiPropose, le contrat retombe sur mission.delaiJours", async () => {
    authAs(clientId);
    const res = await contractPost(postReq({}), {
      params: Promise.resolve({ id: fallbackMissionId }),
    });
    expect(res.status).toBe(200);

    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { missionId: fallbackMissionId },
    });
    const snap = contract.termsSnapshot as { prix: number; delaiJours: number };
    expect(snap.prix).toBe(90000);
    expect(snap.delaiJours).toBe(30);
  });

  it("le HOLD global séquestre le prix du contrat, pas le budget publié", async () => {
    // La signature (2/2) est couverte par contract-signature-workflow.test.ts — ici on simule
    // l'état « contrat signé » pour isoler la logique de montant/garde-fous du HOLD.
    await prisma.prestationContract.update({
      where: { missionId },
      data: { clientSignedAt: new Date(), providerSignedAt: new Date() },
    });
    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { missionId },
    });
    const result = await requestContractHold(contract.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.operation.amount).toBe(120000);
    expect(result.operation.currency).toBe("XOF");
    expect(result.operation.instructionType).toBe("hold");

    // Idempotence : un second HOLD est refusé (déjà demandé).
    const again = await requestContractHold(contract.id);
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe("hold_already_requested");
  });
});
