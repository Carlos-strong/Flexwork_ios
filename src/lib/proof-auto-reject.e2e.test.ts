/**
 * Rejet AUTOMATIQUE de la soumission sur rejet d'UNE preuve (spec §10/14) — branche JALON.
 *
 * POST .../jalons/[jalonId]/deliverable/[attachmentId]/appreciate avec action="rejetee" doit
 * désormais basculer le jalon `livrable_soumis` → `rejete` et tracer un ProgressRejection
 * (append-only) SANS attendre le « Rejeter » de lot explicite (jalons/[jalonId]/reject) — le
 * rejet d'une preuve = rejet de la soumission (SUBMITTED → REJECTED littéralement
 * automatique). Mêmes règles que le rejet de lot : `declaredProgress` repart à 0 (nouveau
 * cycle de resoumission), `observedProgress` conservé (un rejet ne défait jamais une
 * validation antérieure). La branche mission entière (jalonId null) est couverte par
 * deliverable-no-jalon.e2e.test.ts (N14c) — ce fichier couvre le jalon via un setup minimal
 * (même pattern que escrow.test.ts : vrais route handlers, auth mockée, état vérifié en base).
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as appreciateJalonPost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/[attachmentId]/appreciate/route";
import { prisma } from "@/lib/db";

const RUN = Date.now();
let clientId: string;
let providerId: string;
let missionId: string;
let jalonId: string;

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

async function cleanup() {
  await prisma.missionAttachment.deleteMany({ where: { missionId } });
  await prisma.progressCheckpoint.deleteMany({ where: { missionId } });
  await prisma.progressRejection.deleteMany({ where: { missionId } });
  await prisma.contractAuditEntry.deleteMany({ where: { contract: { missionId } } });
  await prisma.contractSignature.deleteMany({ where: { contract: { missionId } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contract: { missionId } } });
  await prisma.prestationContract.deleteMany({ where: { missionId } });
  await prisma.missionProposal.deleteMany({ where: { missionId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.digitalCertificate.deleteMany({ where: { userId: { in: [clientId, providerId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
}

beforeAll(async () => {
  const client = await prisma.user.create({
    data: {
      email: `auto-reject-client-${RUN}@flexwork.test`,
      tel: `+229${RUN}1`,
      role: "client",
      status: "active",
      country: "BJ",
      firstname: "E2E",
      lastname: "ClientAR",
      kycStatus: "verifie",
    },
  });
  const provider = await prisma.user.create({
    data: {
      email: `auto-reject-provider-${RUN}@flexwork.test`,
      tel: `+229${RUN}2`,
      role: "expert_digital",
      status: "active",
      country: "BJ",
      firstname: "E2E",
      lastname: "ProviderAR",
      kycStatus: "verifie",
    },
  });
  clientId = client.id;
  providerId = provider.id;

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `AUTO_REJECT_JALON_${RUN}`,
      description: "Test du rejet automatique de soumission (jalon)",
      domaine: "design",
      budget: 100000,
      currency: "XOF",
      delaiJours: 10,
      riskLevel: "low",
      status: "fonds_sous_sequestre",
    },
  });
  missionId = mission.id;

  const contract = await prisma.prestationContract.create({
    data: {
      missionId,
      clientId,
      providerId,
      termsSnapshot: {},
      currentHash: `auto-reject-${RUN}`,
    },
  });
  // Jalon en attente de décision client (livrable soumis, 40% déclarés / 50% constatés).
  const jalon = await prisma.jalon.create({
    data: {
      contractId: contract.id,
      ordre: 1,
      titre: "Jalon AR",
      montant: 100000,
      status: "livrable_soumis",
      declaredProgress: 40,
      observedProgress: 50,
    },
  });
  jalonId = jalon.id;
});

describe("Rejet automatique SUBMITTED → REJECTED sur rejet d'une preuve (branche jalon)", () => {
  it("le rejet d'une preuve de jalon fait passer le jalon en `rejete` + trace ProgressRejection", async () => {
    const proof = await prisma.missionAttachment.create({
      data: {
        missionId,
        jalonId,
        uploaderId: providerId,
        filePath: `__no_file__/${RUN}`,
        category: "other",
        note: "preuve de test",
      },
    });

    authAs(clientId);
    const res = await appreciateJalonPost(
      postReq({
        action: "rejetee",
        reason: "Sécurité non respectée",
        motif: "Conditions de sécurité non respectées sur le chantier, à reprendre",
        requestNewProof: true,
      }),
      { params: Promise.resolve({ id: missionId, jalonId, attachmentId: proof.id }) }
    );
    expect(res.status).toBe(200);

    // SUBMITTED → REJECTED automatique, sans clic « Rejeter » de lot :
    const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonId } });
    expect(jalon.status).toBe("rejete");
    expect(jalon.rejectionReason).toBe("Sécurité non respectée");
    expect(jalon.revisionCount).toBe(1);
    expect(jalon.declaredProgress).toBe(0); // nouveau cycle de resoumission
    expect(jalon.observedProgress).toBe(50); // conservé — un rejet ne défait pas les 50% constatés

    // Trace append-only pour que le lot rejeté apparaisse comme sa propre version ("…-rej").
    const rejection = await prisma.progressRejection.findFirstOrThrow({
      where: { missionId, jalonId },
      orderBy: { createdAt: "desc" },
    });
    expect(rejection.reason).toBe("Sécurité non respectée");
    expect(rejection.rejectedById).toBe(clientId);

    const updatedProof = await prisma.missionAttachment.findUniqueOrThrow({ where: { id: proof.id } });
    expect(updatedProof.appreciation).toBe("rejetee");
    expect(updatedProof.requestNewProof).toBe(true);
  });

  it("une fois rejeté automatiquement, toute nouvelle appréciation du jalon est refusée (plus en livrable_soumis)", async () => {
    // Jalon déjà `rejete` par le test précédent → rejeter une autre preuve est refusé (409,
    // canDecideJalon) : pas de double ProgressRejection sur la même soumission.
    const proof2 = await prisma.missionAttachment.create({
      data: {
        missionId,
        jalonId,
        uploaderId: providerId,
        filePath: `__no_file__/${RUN}b`,
        category: "other",
        note: "autre preuve",
      },
    });

    authAs(clientId);
    const res = await appreciateJalonPost(
      postReq({
        action: "rejetee",
        reason: "Autre",
        motif: "Second rejet tenté sur un jalon déjà reparti en révision",
      }),
      { params: Promise.resolve({ id: missionId, jalonId, attachmentId: proof2.id }) }
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_deliverable_submitted");

    const count = await prisma.progressRejection.count({ where: { missionId, jalonId } });
    expect(count).toBe(1); // aucune trace supplémentaire
  });
});

afterAll(async () => {
  await cleanup();
});
