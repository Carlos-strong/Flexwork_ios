/**
 * Tests des gardes de sécurité (vague 1 du modèle de sécurité Flexwork) sur les vraies
 * routes, avec vraie base Prisma (même pattern que contract-signature-workflow.test.ts).
 *
 * Couvre, de bout en bout :
 *   - Blocage de l'auto-attribution  : POST /api/missions/[id]/proposals → 403
 *     self_dealing_forbidden pour le commanditaire de la mission
 *   - F-01 : GET /api/missions/[id]/proposals réservé au client propriétaire
 *     (un candidat concurrent et un tiers → 404)
 *   - F-02 : POST /api/signature/verify réservé aux deux parties du contrat (un tiers → 404)
 *   - F-03 : POST /api/webrtc/signal réservé à une mission liée (un destinataire sans
 *     lien → 403)
 *
 * Test « utilisateur tiers → 404 » : le test qui manquait partout (vague 2 du PDF).
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

// Mock auth() AVANT d'importer les routes.
const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as proposalsPost, GET as proposalsGet } from "@/app/api/missions/[id]/proposals/route";
import { POST as verifyPost } from "@/app/api/signature/verify/route";
import { POST as signalPost } from "@/app/api/webrtc/signal/route";
import { GET as messagesGet, POST as messagesPost } from "@/app/api/messages/route";
import { GET as contractGet } from "@/app/api/missions/[id]/contract/route";
import { GET as mediationGet } from "@/app/api/missions/[id]/mediation/route";
import { POST as attachmentsPost } from "@/app/api/missions/[id]/attachments/route";
import { POST as signatureSignPost } from "@/app/api/signature/sign/route";
import { POST as kycSignUrlPost } from "@/app/api/kyc/documents/[id]/sign-url/route";
import { prisma } from "@/lib/db";

const RUN = Date.now();
let clientId: string;
let providerId: string;
let tierceId: string;
let missionId: string;
let contractId: string;
let kycDocId: string;

function authAs(userId: string, role = "client") {
  mockAuth.mockResolvedValue({
    user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur", role },
  });
}

function jsonReq(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function msgGetReq(missionId: string): Request {
  return new Request(`http://localhost/api/messages?missionId=${missionId}`);
}

function msgPostReq(body: unknown): Request {
  return new Request("http://localhost/api/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function attachmentReq(): Promise<Request> {
  const form = new FormData();
  form.append("file", new File(["hello"], "test.txt", { type: "text/plain" }));
  return new Request("http://localhost/api/missions/x/attachments", { method: "POST", body: form });
}

beforeAll(async () => {
  const [client, provider, tierce] = await Promise.all([
    prisma.user.create({
      data: { email: `sg-client-${RUN}@flexwork.test`, tel: `+2299${RUN}1`, role: "client", status: "active", kycStatus: "verifie" },
    }),
    prisma.user.create({
      data: { email: `sg-provider-${RUN}@flexwork.test`, tel: `+2299${RUN}2`, role: "artisan", status: "active", kycStatus: "verifie", dateNaissance: new Date("2000-01-01") },
    }),
    prisma.user.create({
      data: { email: `sg-tierce-${RUN}@flexwork.test`, tel: `+2299${RUN}3`, role: "client", status: "active", kycStatus: "verifie" },
    }),
  ]);
  clientId = client.id;
  providerId = provider.id;
  tierceId = tierce.id;

  // Mission en mode distance (pas de garant/assurance requis), FIXED (candidature prix),
  // publiée et ouverte.
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `SEC_GUARD_${RUN}`,
      description: "Mission de test des gardes de sécurité",
      domaine: "plomberie",
      mode: "distance",
      budget: 100000,
      currency: "XOF",
      delaiJours: 7,
      riskLevel: "low",
      status: "publiee",
      budgetType: "FIXED",
    },
  });
  missionId = mission.id;

  // Contrat direct (pour F-02) — le cycle complet via la route /contract est déjà couvert
  // par contract-signature-workflow.test.ts ; ici on teste uniquement la propriété.
  const contract = await prisma.prestationContract.create({
    data: {
      missionId,
      clientId,
      providerId,
      termsSnapshot: { objet: "Test", prix: 100000 },
      currentHash: `sg-hash-${RUN}`,
    },
  });
  contractId = contract.id;

  // Document KYC appartenant au prestataire (pour tester la propriété de kyc/sign-url).
  const kycDoc = await prisma.kycDocument.create({
    data: { userId: providerId, type: "selfie", filePath: "storage/kyc-docs/test.jpg" },
  });
  kycDocId = kycDoc.id;
});

afterAll(async () => {
  await prisma.contractSignature.deleteMany({ where: { contractId } });
  await prisma.contractAuditEntry.deleteMany({ where: { contractId } });
  await prisma.prestationContract.deleteMany({ where: { id: contractId } });
  await prisma.message.deleteMany({ where: { missionId } });
  await prisma.kycDocument.deleteMany({ where: { id: kycDocId } });
  await prisma.missionProposal.deleteMany({ where: { missionId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId, tierceId] } } });
});

describe("Invariant — auto-attribution (self-dealing)", () => {
  it("refuse la candidature du commanditaire à sa propre mission (403)", async () => {
    authAs(clientId);
    const res = await proposalsPost(jsonReq({ montant: 5000, message: "auto" }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("self_dealing_forbidden");
  });

  it("accepte la candidature d'un vrai prestataire (200)", async () => {
    authAs(providerId, "artisan");
    const res = await proposalsPost(jsonReq({ montant: 5000, message: "ok" }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);
  });
});

describe("F-01 — les candidatures ne sont lisibles que par le client propriétaire", () => {
  it("le client propriétaire voit les candidatures reçues (200)", async () => {
    authAs(clientId);
    const res = await proposalsGet(new Request("http://localhost/api/missions/x/proposals"), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].providerId).toBe(providerId);
  });

  // Depuis 2026-09-03 la route est rôle-aware : un candidat est partie à la mission, il
  // n'est donc plus renvoyé en 404 — il lit la MÊME page, filtrée à sa seule candidature.
  // Ce qui reste à garder fermé, c'est la fuite : il ne doit voir aucune offre concurrente.
  it("un candidat ne voit que SA candidature (200, aucune concurrente)", async () => {
    authAs(providerId, "artisan");
    const res = await proposalsGet(new Request("http://localhost/api/missions/x/proposals"), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.items.length).toBe(1);
    expect(data.items[0].providerId).toBe(providerId);
  });

  it("un tiers sans lien → 404 (indistinguable d'une mission inexistante)", async () => {
    authAs(tierceId);
    const res = await proposalsGet(new Request("http://localhost/api/missions/x/proposals"), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(404);
  });
});

describe("F-02 — les métadonnées de signature sont réservées aux parties du contrat", () => {
  it("un tiers → 404", async () => {
    authAs(tierceId);
    const res = await verifyPost(jsonReq({ contractId }));
    expect(res.status).toBe(404);
  });

  it("une partie au contrat → 200 (données renvoyées)", async () => {
    authAs(clientId);
    const res = await verifyPost(jsonReq({ contractId }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.contractId).toBe(contractId);
  });
});

describe("F-03 — le signal visio exige une mission liée émetteur ↔ destinataire", () => {
  it("client → prestataire candidat de la mission : 200", async () => {
    authAs(clientId);
    const res = await signalPost(jsonReq({ to: providerId, type: "offer", payload: { sdp: "x" } }));
    expect(res.status).toBe(200);
  });

  it("client → destinataire sans aucun lien : 403", async () => {
    authAs(clientId);
    const res = await signalPost(jsonReq({ to: tierceId, type: "offer", payload: { sdp: "x" } }));
    expect(res.status).toBe(403);
  });
});

describe("Vague 2 — fuites IDOR fermées : partie → OK, tiers → 404", () => {
  it("messages GET ?missionId : partie → 200, tiers → 404", async () => {
    authAs(clientId);
    expect((await messagesGet(msgGetReq(missionId))).status).toBe(200);

    authAs(tierceId);
    expect((await messagesGet(msgGetReq(missionId))).status).toBe(404);
  });

  it("messages POST : partie → 200, tiers → 404", async () => {
    authAs(clientId);
    expect((await messagesPost(msgPostReq({ missionId, content: "bonjour" }))).status).toBe(200);

    authAs(tierceId);
    expect((await messagesPost(msgPostReq({ missionId, content: "bonjour" }))).status).toBe(404);
  });

  it("contract GET : partie → 200, tiers → 404", async () => {
    authAs(clientId);
    expect((await contractGet(new Request("http://localhost/api/missions/x/contract"), { params: Promise.resolve({ id: missionId }) })).status).toBe(200);

    authAs(tierceId);
    expect((await contractGet(new Request("http://localhost/api/missions/x/contract"), { params: Promise.resolve({ id: missionId }) })).status).toBe(404);
  });

  it("mediation GET : partie → 200, tiers → 404", async () => {
    authAs(clientId);
    expect((await mediationGet(new Request("http://localhost/api/missions/x/mediation"), { params: Promise.resolve({ id: missionId }) })).status).toBe(200);

    authAs(tierceId);
    expect((await mediationGet(new Request("http://localhost/api/missions/x/mediation"), { params: Promise.resolve({ id: missionId }) })).status).toBe(404);
  });

  it("attachments POST : tiers → 404 ; une partie atteint le contrôle de statut (pas 404)", async () => {
    authAs(tierceId);
    expect((await attachmentsPost(await attachmentReq(), { params: Promise.resolve({ id: missionId }) })).status).toBe(404);

    // Partie au contrat : le garde laisse passer, c'est le statut de mission qui bloque (403).
    authAs(clientId);
    const res = await attachmentsPost(await attachmentReq(), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("attachment_blocked_before_proposal_accepted");
  });

  it("signature/sign : un tiers → 404 (pas d'oracle d'existence)", async () => {
    authAs(tierceId);
    const res = await signatureSignPost(jsonReq({ contractId, certificateId: "x", passphrase: "x" }));
    expect(res.status).toBe(404);
  });

  it("kyc sign-url : propriétaire → 200, tiers → 404", async () => {
    authAs(providerId);
    expect((await kycSignUrlPost(new Request("http://localhost/api"), { params: Promise.resolve({ id: kycDocId }) })).status).toBe(200);

    authAs(tierceId);
    expect((await kycSignUrlPost(new Request("http://localhost/api"), { params: Promise.resolve({ id: kycDocId }) })).status).toBe(404);
  });
});
