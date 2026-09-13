/**
 * Tests E2E du workflow réel « contrat + signature numérique + QR ».
 *
 * Ce fichier teste le workflow EFFECTIVEMENT implémenté dans Flexwork, de bout en bout,
 * en appelant les vrais route handlers Next.js (avec mock de `auth()`) puis en vérifiant
 * l'état en base (Prisma) et les fonctions d'intégrité du service de signature.
 *
 * Workflow couvert :
 *   1. Génération du contrat depuis une proposition acceptée   (POST /api/missions/[id]/contract)
 *   2. Génération de certificats RSA-2048 client & prestataire  (POST /api/signature/certificate)
 *   3. Rejet d'une signature avec mauvaise passphrase
 *   4. Signature prestataire (1/2)                               (POST /api/signature/sign)
 *   5. Signature client (2/2) → verrouillage automatique
 *   6. Rejet d'une 3ᵉ signature (contrat verrouillé)
 *   7. Vérification cryptographique des 2 signatures            (POST /api/signature/verify)
 *   8. Égalité hash stocké == hash recalculé + intégrité
 *   9. Piste d'audit chaînée (CLIENT_SIGNED, PROVIDER_SIGNED, LOCKED)
 *  10. Encodage QR depuis les données réelles de signature
 *  11. Détection d'altération (tamper → intégrité invalide)
 *
 * Différences avec le plan de test de la maquette de signature : voir
 * `analyse-plan-test-contrat-signature.md` (pas de PDF/watermark, pas de lien magique,
 * pas de page publique /verify — la signature est cryptographique avec certificats RSA).
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock auth() AVANT d'importer les routes (voir webrtc-e2e.test.ts)
// ---------------------------------------------------------------------------
const mockAuth = vi.fn();

vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

// ---------------------------------------------------------------------------
// Imports post-mock
// ---------------------------------------------------------------------------
import { POST as contractPost } from "@/app/api/missions/[id]/contract/route";
import { POST as certificatePost } from "@/app/api/signature/certificate/route";
import { POST as signPost } from "@/app/api/signature/sign/route";
import { POST as verifyPost } from "@/app/api/signature/verify/route";
import { SignatureService } from "@/lib/signature";
import type { ContractSnapshot } from "@/lib/contract-clauses";
import { prisma } from "@/lib/db";
import QRCode from "qrcode";

// ---------------------------------------------------------------------------
// Fixtures uniques par exécution (évite les collisions entre runs)
// ---------------------------------------------------------------------------
const RUN = Date.now();
const CLIENT_EMAIL = `wf-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `wf-provider-${RUN}@flexwork.test`;
const PASSPHRASE = "passphrase-secure-2026";

let clientId: string;
let providerId: string;
let missionId: string;
let contractId: string;
let clientCertId: string;
let clientCertFingerprint: string;
let providerCertId: string;
let providerCertFingerprint: string;
let clientSignResult: Awaited<ReturnType<typeof SignatureService.signContract>>;
let providerSignResult: Awaited<ReturnType<typeof SignatureService.signContract>>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  // Le stub PSP (ESCROW_STUB_AUTOCONFIRM=true, présent dans le .env de dev local) est une
  // commodité de développement : ce test couvre le workflow de SIGNATURE, pas la confirmation
  // PSP. On le désactive pour rester déterministe quel que soit le .env local — la mission
  // reste `contrat_signe` après la 2ᵉ signature tant que le PSP (réel ou simulé) n'a pas
  // confirmé le HOLD (chaque fichier de test tourne dans son propre process, l'env est isolé).
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}1`, role: "client", status: "active" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}2`, role: "artisan", status: "active" },
  });
  clientId = client.id;
  providerId = provider.id;

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `TEST_WORKFLOW_CONTRAT_${RUN}`,
      description: "Mission de test workflow contrat + signature",
      domaine: "plomberie",
      budget: 100000,
      currency: "XOF",
      delaiJours: 30,
      status: "proposition_acceptee",
    },
  });
  missionId = mission.id;

  await prisma.missionProposal.create({
    data: {
      missionId,
      providerId,
      montant: 100000,
      message: "Proposition de test",
      status: "acceptee",
    },
  });
});

afterAll(async () => {
  await prisma.contractAuditEntry.deleteMany({ where: { contract: { missionId } } });
  await prisma.contractSignature.deleteMany({ where: { contract: { missionId } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contract: { missionId } } });
  await prisma.jalon.deleteMany({ where: { contract: { missionId } } });
  await prisma.prestationContract.deleteMany({ where: { missionId } });
  await prisma.missionProposal.deleteMany({ where: { missionId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.digitalCertificate.deleteMany({
    where: { userId: { in: [clientId, providerId] } },
  });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

// ---------------------------------------------------------------------------
// Workflow
// ---------------------------------------------------------------------------

describe("Workflow contrat + signature + QR (implémentation réelle)", () => {
  it("S1 — génère le contrat depuis la proposition acceptée", async () => {
    authAs(clientId);

    const res = await contractPost(postReq({}), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeDefined();
    contractId = body.id;

    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { id: contractId },
      include: { mission: true },
    });
    expect(contract.termsSnapshot).toBeDefined();
    expect(contract.currentHash).toBeDefined();
    expect(contract.clientSignedAt).toBeNull();
    expect(contract.providerSignedAt).toBeNull();
    expect(contract.mission.status).toBe("contrat_genere");
    // Clause de conformité : la plateforme n'est jamais partie au contrat. Le snapshot est
    // stocké en JSON (nullable) — on le réduit au type du format réel (contract-clauses.ts).
    const snapshot = contract.termsSnapshot as unknown as ContractSnapshot;
    expect(snapshot.clausePlateformeNonPartie).toContain("n'est pas partie");
  });

  it("S1 — refuse de générer un second contrat pour la même mission", async () => {
    authAs(clientId);
    const res = await contractPost(postReq({}), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("contract_already_generated");
  });

  it("S3/S4 — génère un certificat RSA-2048 pour le client", async () => {
    authAs(clientId);
    const res = await certificatePost(
      postReq({ commonName: "Client Test", email: CLIENT_EMAIL, passphrase: PASSPHRASE })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.status).toBe("ACTIVE");
    expect(body.data.publicKey).toContain("BEGIN PUBLIC KEY");
    expect(body.data.keyFingerprint).toMatch(/^([A-F0-9]{2}:){31}[A-F0-9]{2}$/);
    clientCertId = body.data.id;
    clientCertFingerprint = body.data.keyFingerprint;
  });

  it("S3/S4 — refuse une passphrase de moins de 8 caractères", async () => {
    authAs(providerId);
    const res = await certificatePost(
      postReq({ commonName: "Artisan Test", email: PROVIDER_EMAIL, passphrase: "court" })
    );
    expect(res.status).toBe(400);
  });

  it("S3/S4 — génère un certificat RSA-2048 pour le prestataire", async () => {
    authAs(providerId);
    const res = await certificatePost(
      postReq({ commonName: "Artisan Test", email: PROVIDER_EMAIL, passphrase: PASSPHRASE })
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.data.status).toBe("ACTIVE");
    providerCertId = body.data.id;
    providerCertFingerprint = body.data.keyFingerprint;
  });

  it("S3 — refuse la signature du client AVANT celle du prestataire (ordre imposé)", async () => {
    authAs(clientId);
    const res = await signPost(
      postReq({ contractId, certificateId: clientCertId, passphrase: PASSPHRASE })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("provider_must_sign_first");
  });

  it("S3 — refuse une signature avec une mauvaise passphrase", async () => {
    authAs(providerId);
    const res = await signPost(
      postReq({ contractId, certificateId: providerCertId, passphrase: "mauvaise-passphrase" })
    );
    expect(res.status).toBe(500);
  });

  it("S3 — le prestataire signe (1/2) : contrat non verrouillé", async () => {
    authAs(providerId);
    const res = await signPost(
      postReq({ contractId, certificateId: providerCertId, passphrase: PASSPHRASE })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.role).toBe("PRESTATAIRE");
    expect(body.isLocked).toBe(false);
    expect(body.signatureId).toBeDefined();
    expect(body.signedDataHash).toMatch(/^[a-f0-9]{64}$/);
    providerSignResult = body;

    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { id: contractId },
      include: { mission: true },
    });
    expect(contract.providerSignedAt).not.toBeNull();
    expect(contract.clientSignedAt).toBeNull();
    expect(contract.mission.status).toBe("contrat_genere");

    const sigCount = await prisma.contractSignature.count({ where: { contractId } });
    expect(sigCount).toBe(1);
  });

  it("S4 — le client signe (2/2) : verrouillage automatique", async () => {
    authAs(clientId);
    const res = await signPost(
      postReq({ contractId, certificateId: clientCertId, passphrase: PASSPHRASE })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.role).toBe("CLIENT");
    expect(body.isLocked).toBe(true);
    clientSignResult = body;

    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { id: contractId },
      include: { mission: true },
    });
    expect(contract.clientSignedAt).not.toBeNull();
    expect(contract.providerSignedAt).not.toBeNull();
    expect(contract.mission.status).toBe("contrat_signe");

    const sigCount = await prisma.contractSignature.count({ where: { contractId } });
    expect(sigCount).toBe(2);
  });

  it("S3/S4 — refuse une signature supplémentaire (contrat verrouillé)", async () => {
    authAs(clientId);
    const res = await signPost(
      postReq({ contractId, certificateId: clientCertId, passphrase: PASSPHRASE })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("already_signed");
  });

  it("S5 — vérifie cryptographiquement les deux signatures", async () => {
    authAs(clientId);
    const res = await verifyPost(postReq({ contractId }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.signatures).toHaveLength(2);
    for (const sig of body.signatures) {
      expect(sig.signatureValid).toBe(true);
      expect(sig.signingMethod).toBe("RSA-SHA256");
    }
    expect(body.clientSignedAt).not.toBeNull();
    expect(body.providerSignedAt).not.toBeNull();
  });

  it("S5 — hash stocké == hash recalculé + intégrité vérifiée", async () => {
    const { hash } = await SignatureService.computeContractHash(contractId);
    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { id: contractId },
    });
    expect(contract.currentHash).toBe(hash);

    const integrity = await SignatureService.checkIntegrity(contractId);
    expect(integrity.valid).toBe(true);
    expect(integrity.reason).toContain("Intégrité vérifiée");
  });

  it("S5 — piste d'audit chaînée avec les bons événements", async () => {
    const trail = await SignatureService.getAuditTrail(contractId);
    expect(trail.chainValid).toBe(true);
    const events = trail.entries.map((e) => e.event);
    expect(events).toContain("CLIENT_SIGNED");
    expect(events).toContain("PROVIDER_SIGNED");
    expect(events).toContain("LOCKED");
  });

  it("S5 — le QR encode des données réelles et vérifiables", async () => {
    // Même payload que src/components/signature-qrcode.tsx, avec les données de la
    // signature réellement renvoyée par POST /api/signature/sign.
    const qrPayload = JSON.stringify({
      v: 1,
      cid: contractId,
      sid: providerSignResult.signatureId,
      role: "PRESTATAIRE",
      signer: "Artisan Test",
      ts: providerSignResult.signedAt,
      fingerprint: providerCertFingerprint,
      hash: providerSignResult.signedDataHash,
      method: "RSA-SHA256",
      verify: "/api/signature/verify",
    });

    const parsed = JSON.parse(qrPayload);
    expect(parsed.cid).toBe(contractId);
    expect(parsed.hash).toBe(providerSignResult.signedDataHash);
    expect(parsed.fingerprint).toBe(providerCertFingerprint);

    // Le payload est réellement encodable en PNG (même bibliothèque que le composant).
    const buf = await QRCode.toBuffer(qrPayload, { type: "png" });
    expect(buf.length).toBeGreaterThan(0);
  });

  it("R4 — détecte une altération du contrat après verrouillage", async () => {
    // Altération d'un octet logique : modification de la description de la mission,
    // qui fait partie du contenu hashé par computeContractHash().
    await prisma.mission.update({
      where: { id: missionId },
      data: { description: "Description ALTÉRÉE après signature" },
    });

    const integrity = await SignatureService.checkIntegrity(contractId);
    expect(integrity.valid).toBe(false);
    expect(integrity.reason).toContain("ALTÉRATION");
  });
});
