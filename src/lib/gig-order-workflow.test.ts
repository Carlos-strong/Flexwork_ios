/**
 * Tests E2E du workflow réel « Modèle Gig » (recommandation #3) — prestataire publie un
 * Gig à prix fixe, client l'achète, flux de signature INVERSÉ (client 1/2 puis prestataire
 * 2/2), délai 24h sinon remboursement automatique.
 *
 * Workflow couvert :
 *   1. Publication d'un Gig par le prestataire            (POST /api/gigs)
 *   2. Achat par le client → commande créée               (POST /api/gigs/[id]/purchase)
 *   3. Ordre INVERSÉ imposé : prestataire avant client → 409 client_must_sign_first
 *   4. Signature client (1/2) → séquestre HOLD + statut client_signed
 *   5. Signature prestataire (2/2) → verrouillage + statut active
 *   6. Auto-achat interdit (client ≠ prestataire d'un même Gig) → self_dealing_forbidden
 *   7. Délai 24h : clientSignedAt backdaté >24h → remboursement auto + statut refunded
 *
 * Même pattern que contract-signature-workflow.test.ts : vrais route handlers Next.js
 * (mock de `auth()`), état vérifié en base (Prisma) et crypto réelle (RSA-2048).
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({
  auth: () => mockAuth(),
}));

// Imports post-mock
import { POST as gigPost } from "@/app/api/gigs/route";
import { POST as purchasePost } from "@/app/api/gigs/[id]/purchase/route";
import { POST as signPost } from "@/app/api/gigs/orders/[orderId]/sign/route";
import { GigSignatureService } from "@/lib/gig-signature";
import { refundExpiredOrder, PROVIDER_SIGN_DEADLINE_HOURS } from "@/lib/gig-expiry";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const CLIENT_EMAIL = `gig-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `gig-provider-${RUN}@flexwork.test`;
const PASSPHRASE = "gig-passphrase-2026";

let clientId: string;
let providerId: string;
let gigId: string;
let orderId: string;
let clientCertId: string;
let providerCertId: string;

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

beforeAll(async () => {
  const client = await prisma.user.create({
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}1`, role: "client", status: "active" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}2`, role: "expert_digital", status: "active" },
  });
  clientId = client.id;
  providerId = provider.id;
});

afterAll(async () => {
  await prisma.gigOrderAuditEntry.deleteMany({ where: { order: { gigId } } });
  await prisma.gigOrderSignature.deleteMany({ where: { order: { gigId } } });
  await prisma.gigOrderEscrowOperation.deleteMany({ where: { order: { gigId } } });
  await prisma.gigOrder.deleteMany({ where: { gigId } });
  await prisma.gig.deleteMany({ where: { id: gigId } });
  await prisma.digitalCertificate.deleteMany({ where: { userId: { in: [clientId, providerId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
});

describe("Workflow modèle Gig (implémentation réelle)", () => {
  it("S1 — le prestataire publie un Gig à prix fixe", async () => {
    authAs(providerId);
    const res = await gigPost(postReq({
      titre: "Site vitrine — création complète",
      description: "Création d'un site vitrine moderne (5 pages).",
      domaine: "expert_digital",
      prix: 250000,
      delaiJours: 14,
      tags: ["web", "vitrine"],
      status: "publie",
    }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    gigId = body.id;

    const gig = await prisma.gig.findUniqueOrThrow({ where: { id: gigId } });
    expect(gig.status).toBe("publie");
    expect(gig.prix).toBe(250000);
    expect(gig.providerId).toBe(providerId);
  });

  it("S1 — un client ne peut pas publier un Gig (403)", async () => {
    authAs(clientId);
    const res = await gigPost(postReq({
      titre: "Interdit",
      description: "x",
      domaine: "expert_digital",
      prix: 1000,
      delaiJours: 1,
    }));
    expect(res.status).toBe(403);
  });

  it("S2 — le client achète le Gig → commande créée", async () => {
    authAs(clientId);
    const res = await purchasePost(postReq({}), { params: Promise.resolve({ id: gigId }) });
    expect(res.status).toBe(201);
    const body = await res.json();
    orderId = body.orderId;

    const order = await prisma.gigOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("created");
    expect(order.montant).toBe(250000);
    expect(order.clientId).toBe(clientId);
    expect(order.providerId).toBe(providerId);
    expect(order.termsSnapshot).toMatchObject({ prix: 250000 });
  });

  it("S2 — auto-achat interdit (le prestataire ne peut pas acheter son propre Gig)", async () => {
    authAs(providerId);
    const res = await purchasePost(postReq({}), { params: Promise.resolve({ id: gigId }) });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("self_dealing_forbidden");
  });

  it("S3 — génère les certificats (client + prestataire) et vérifie l'ordre inversé", async () => {
    // Génération directe via SignatureService.generateCertificate (crypto réelle).
    const { SignatureService } = await import("@/lib/signature");
    const cCert = await SignatureService.generateCertificate({
      userId: clientId,
      commonName: "Client Gig",
      email: CLIENT_EMAIL,
      passphrase: PASSPHRASE,
    });
    clientCertId = cCert.id;
    const pCert = await SignatureService.generateCertificate({
      userId: providerId,
      commonName: "Prestataire Gig",
      email: PROVIDER_EMAIL,
      passphrase: PASSPHRASE,
    });
    providerCertId = pCert.id;
    expect(cCert.status).toBe("ACTIVE");
    expect(pCert.status).toBe("ACTIVE");

    // Le prestataire tente de signer EN PREMIER → 409 (ordre inversé).
    authAs(providerId);
    const res = await signPost(postReq({ certificateId: providerCertId, passphrase: PASSPHRASE }), {
      params: Promise.resolve({ orderId }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("client_must_sign_first");
  });

  it("S4 — le client signe (1/2) → séquestre HOLD + statut client_signed", async () => {
    authAs(clientId);
    const res = await signPost(postReq({ certificateId: clientCertId, passphrase: PASSPHRASE }), {
      params: Promise.resolve({ orderId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("CLIENT");
    expect(body.isLocked).toBe(false);

    const order = await prisma.gigOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("client_signed");
    expect(order.clientSignedAt).not.toBeNull();
    expect(order.providerSignedAt).toBeNull();

    const holds = await prisma.gigOrderEscrowOperation.findMany({ where: { orderId, instructionType: "hold" } });
    expect(holds.length).toBe(1);
    expect(holds[0].status).toBe("confirmed");
    expect(holds[0].amount).toBe(250000);

    const audit = await prisma.gigOrderAuditEntry.findFirst({
      where: { orderId, event: "CLIENT_SIGNED_GIG" },
    });
    expect(audit).not.toBeNull();
  });

  it("S5 — le prestataire signe (2/2) → verrouillage + statut active", async () => {
    authAs(providerId);
    const res = await signPost(postReq({ certificateId: providerCertId, passphrase: PASSPHRASE }), {
      params: Promise.resolve({ orderId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe("PRESTATAIRE");
    expect(body.isLocked).toBe(true);

    const order = await prisma.gigOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe("active");
    expect(order.providerSignedAt).not.toBeNull();

    const sigs = await prisma.gigOrderSignature.count({ where: { orderId } });
    expect(sigs).toBe(2);

    const locked = await prisma.gigOrderAuditEntry.findFirst({ where: { orderId, event: "LOCKED_GIG" } });
    expect(locked).not.toBeNull();
  });

  it("S5 — une 3ᵉ signature est rejetée (commande verrouillée)", async () => {
    authAs(clientId);
    const res = await signPost(postReq({ certificateId: clientCertId, passphrase: PASSPHRASE }), {
      params: Promise.resolve({ orderId }),
    });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("already_signed");
  });

  it("S6 — vérification cryptographique des 2 signatures (QR)", async () => {
    const verify = await GigSignatureService.verifySignature({ orderId });
    expect(verify.signatures.length).toBe(2);
    for (const s of verify.signatures) {
      expect(s.signatureValid).toBe(true);
      expect(s.signedDataHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("S7 — délai 24h : commande non signée par le prestataire → remboursement auto", async () => {
    // Nouvelle commande, signée par le client, puis clientSignedAt backdaté > 24h.
    const order = await prisma.gigOrder.create({
      data: {
        gigId,
        clientId,
        providerId,
        montant: 250000,
        currency: "XOF",
        termsSnapshot: { gig: { titre: "Expirée" }, prix: 250000 },
        status: "client_signed",
        clientSignedAt: new Date(Date.now() - (PROVIDER_SIGN_DEADLINE_HOURS + 1) * 3600_000),
      },
    });

    const refunded = await refundExpiredOrder(order.id);
    expect(refunded).toBe(true);

    const updated = await prisma.gigOrder.findUniqueOrThrow({ where: { id: order.id } });
    expect(updated.status).toBe("refunded");
    expect(updated.refundedAt).not.toBeNull();

    const refunds = await prisma.gigOrderEscrowOperation.findMany({
      where: { orderId: order.id, instructionType: "refund" },
    });
    expect(refunds.length).toBe(1);

    const audit = await prisma.gigOrderAuditEntry.findFirst({
      where: { orderId: order.id, event: "GIG_ORDER_EXPIRED" },
    });
    expect(audit).not.toBeNull();

    // Idempotent
    expect(await refundExpiredOrder(order.id)).toBe(false);

    // Nettoyage de la commande de test d'expiration
    await prisma.gigOrderAuditEntry.deleteMany({ where: { orderId: order.id } });
    await prisma.gigOrderSignature.deleteMany({ where: { orderId: order.id } });
    await prisma.gigOrderEscrowOperation.deleteMany({ where: { orderId: order.id } });
    await prisma.gigOrder.deleteMany({ where: { id: order.id } });
  });
});
