import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { SignatureService } from "./signature";
import { prisma } from "./db";

// Tests d'intégration pour le service de signature numérique.
// Crée des fixtures (User, Mission, PrestationContract) dans beforeAll.

const TEST_EMAIL = "sig-test@flexwork.test";
const TEST_TEL = "+22999999999";
let testUserId: string;
let testContractId: string;

beforeAll(async () => {
  // Créer ou récupérer l'utilisateur de test
  let user = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (!user) {
    user = await prisma.user.create({
      data: {
        email: TEST_EMAIL,
        tel: TEST_TEL,
        role: "client",
        status: "active",
      },
    });
  }
  testUserId = user.id;

  // Nettoyer les anciennes données de signature
  await prisma.contractSignature.deleteMany({ where: { contract: { mission: { clientId: testUserId } } } });
  await prisma.contractAuditEntry.deleteMany({ where: { contract: { mission: { clientId: testUserId } } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contract: { mission: { clientId: testUserId } } } });
  await prisma.jalon.deleteMany({ where: { contract: { mission: { clientId: testUserId } } } });
  await prisma.prestationContract.deleteMany({ where: { mission: { clientId: testUserId } } });
  await prisma.missionProposal.deleteMany({ where: { mission: { clientId: testUserId } } });
  await prisma.mission.deleteMany({ where: { clientId: testUserId, titre: "TEST_SIGNATURE" } });
  await prisma.digitalCertificate.deleteMany({ where: { userId: testUserId } });

  // Créer une mission de test
  const mission = await prisma.mission.create({
    data: {
      clientId: testUserId,
      titre: "TEST_SIGNATURE",
      description: "Mission de test signature",
      domaine: "informatique",
      budget: 100000,
      delaiJours: 30,
      status: "contrat_genere",
    },
  });

  // Créer un contrat de test
  const contract = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId: testUserId,
      providerId: testUserId, // même user pour simplifier le test
      termsSnapshot: { titre: "TEST_SIGNATURE", budget: 100000 },
      acceptanceDeadlineDays: 7,
      currentHash: "initial-hash-test",
    },
  });
  testContractId = contract.id;
});

afterAll(async () => {
  // Nettoyage en cascade via la mission
  await prisma.contractSignature.deleteMany({ where: { contractId: testContractId } });
  await prisma.contractAuditEntry.deleteMany({ where: { contractId: testContractId } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId: testContractId } });
  await prisma.jalon.deleteMany({ where: { contractId: testContractId } });
  await prisma.prestationContract.deleteMany({ where: { id: testContractId } });
  await prisma.mission.deleteMany({ where: { clientId: testUserId, titre: "TEST_SIGNATURE" } });
  await prisma.digitalCertificate.deleteMany({ where: { userId: testUserId } });
  // Ne pas supprimer l'utilisateur — pourrait être utilisé par d'autres tests
});

describe("SignatureService — génération de certificat", () => {
  it("génère un certificat RSA-2048 avec clé chiffrée", async () => {
    const cert = await SignatureService.generateCertificate({
      userId: testUserId,
      commonName: "Jean Testeur",
      email: "jean@test.local",
      passphrase: "ma-super-passphrase-2026",
    });

    expect(cert).toBeDefined();
    expect(cert.userId).toBe(testUserId);
    expect(cert.commonName).toBe("Jean Testeur");
    expect(cert.status).toBe("ACTIVE");
    expect(cert.publicKey).toContain("BEGIN PUBLIC KEY");
    expect(cert.keyFingerprint).toMatch(/^([A-F0-9]{2}:){31}[A-F0-9]{2}$/);
  });

  it("révoque l'ancien certificat actif lors de la génération d'un nouveau", async () => {
    const cert1 = await SignatureService.generateCertificate({
      userId: testUserId,
      commonName: "Jean V1",
      email: "jean@test.local",
      passphrase: "passphrase-secure-2026",
    });

    const cert2 = await SignatureService.generateCertificate({
      userId: testUserId,
      commonName: "Jean V2",
      email: "jean@test.local",
      passphrase: "autre-passphrase-2026",
    });

    const revoked = await prisma.digitalCertificate.findUnique({
      where: { id: cert1.id },
      select: { status: true, revokeReason: true },
    });

    expect(revoked?.status).toBe("REVOKED");
    expect(revoked?.revokeReason).toBe("Remplacé par un nouveau certificat");
    expect(cert2.status).toBe("ACTIVE");
  });
});

describe("SignatureService — audit", () => {
  it("crée une entrée d'audit avec chaîne de hash", async () => {
    await SignatureService.addAuditEntry(
      testContractId,
      "TEST_EVENT",
      "Événement de test",
      { foo: "bar" }
    );

    const entries = await prisma.contractAuditEntry.findMany({
      where: { contractId: testContractId },
      orderBy: { createdAt: "asc" },
    });

    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].event).toBe("TEST_EVENT");
    expect(entries[0].currentHash).toBeDefined();
    expect(entries[0].previousHash).toBeNull();
  });

  it("chaîne les entrées d'audit (previousHash -> currentHash)", async () => {
    await SignatureService.addAuditEntry(testContractId, "EVENT_A", "Premier");
    await SignatureService.addAuditEntry(testContractId, "EVENT_B", "Deuxième");

    const entries = await prisma.contractAuditEntry.findMany({
      where: { contractId: testContractId },
      orderBy: { createdAt: "asc" },
    });

    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].previousHash).toBe(entries[i - 1].currentHash);
    }
  });
});

describe("SignatureService — piste d'audit", () => {
  it("getAuditTrail retourne la chaîne complète et valide", async () => {
    const trail = await SignatureService.getAuditTrail(testContractId);
    expect(trail.contractId).toBe(testContractId);
    expect(trail.entries.length).toBeGreaterThanOrEqual(3);
    expect(trail.chainValid).toBe(true);
  });
});

