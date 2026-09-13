/**
 * Test E2E complet du cycle de vie d'une mission (2026-08-31) :
 *
 *   création → publication → candidature → acceptation → contrat (à jalons) →
 *   signatures (prestataire 1/2 puis client 2/2) → financement des jalons (HOLD PSP) →
 *   livrables → validation → libération (RELEASE PSP) → clôture de la mission.
 *
 * Un contrat à jalons atteint `cloturee` une fois TOUS les jalons `libere`
 * (src/lib/psp-webhook.ts). Depuis le 2026-09-02, un contrat SANS jalon atteint `cloturee`
 * directement à la confirmation de son unique RELEASE (voir psp-virtual.test.ts pour ce
 * second chemin) — auparavant il restait bloqué à `validee`, un
 * cul-de-sac où le lien "Donner un avis" n'était jamais atteignable. Ce test emprunte le
 * chemin fractionné (jalons) ; voir mission-lifecycle-devis.e2e.test.ts pour le même cycle
 * emprunté via le vrai circuit devis (budgetType QUOTE) plutôt qu'une candidature prix fixe.
 *
 * Confirmations PSP : mode console de la PSP virtuelle (src/lib/psp-virtual.ts) — chaque
 * HOLD/RELEASE est confirmé explicitement via `operateVirtualPsp`, qui passe par le même
 * chemin webhook signé qu'un vrai PSP (US-503).
 *
 * Même pattern que contract-signature-workflow.test.ts : vrais route handlers Next.js avec
 * mock de `auth()`, état vérifié en base (Prisma).
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as missionPost } from "@/app/api/missions/route";
import { POST as proposalPost } from "@/app/api/missions/[id]/proposals/route";
import { POST as acceptPost } from "@/app/api/missions/[id]/proposals/[proposalId]/accept/route";
import { POST as contractPost } from "@/app/api/missions/[id]/contract/route";
import { POST as certPost } from "@/app/api/signature/certificate/route";
import { POST as signPost } from "@/app/api/signature/sign/route";
import { POST as jalonHoldPost } from "@/app/api/missions/[id]/jalons/[jalonId]/hold/route";
import { POST as deliverablePost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/route";
import { POST as jalonSubmitPost } from "@/app/api/missions/[id]/jalons/[jalonId]/submit/route";
import { POST as observePost } from "@/app/api/missions/[id]/jalons/[jalonId]/observe-progress/route";
import { POST as validatePost } from "@/app/api/missions/[id]/jalons/[jalonId]/validate/route";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-provider-${RUN}@flexwork.test`;
const PASSPHRASE = "passphrase-e2e-2026";
const BUDGET = 150000;
const JALONS = [
  { titre: "Jalon 1 — Design", montant: 100000 },
  { titre: "Jalon 2 — Développement", montant: 50000 },
];

let clientId: string;
let providerId: string;
let missionId: string;
let proposalId: string;
let contractId: string;
let jalonIds: string[];
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

function deliverableForm(): Request {
  const fd = new FormData();
  fd.append("category", "other");
  fd.append("note", "Preuve de livraison — test E2E complet");
  return new Request("http://localhost/api", { method: "POST", body: fd });
}

async function cleanup() {
  await prisma.contractAuditEntry.deleteMany({ where: { contract: { missionId } } });
  await prisma.contractSignature.deleteMany({ where: { contract: { missionId } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contract: { missionId } } });
  await prisma.missionAttachment.deleteMany({ where: { missionId } });
  await prisma.jalon.deleteMany({ where: { contract: { missionId } } });
  await prisma.prestationContract.deleteMany({ where: { missionId } });
  await prisma.missionProposal.deleteMany({ where: { missionId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.digitalCertificate.deleteMany({ where: { userId: { in: [clientId, providerId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
  // ⚠️ PAS de suppression du flag psp_montage_valide (fixture partagé, voir escrow.test.ts).
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM; // mode console : confirmations PSP explicites

  const client = await prisma.user.create({
    data: {
      email: CLIENT_EMAIL,
      tel: `+229${RUN}8`,
      role: "client",
      status: "active",
      country: "BJ",
      firstname: "E2E",
      lastname: "Client",
      kycStatus: "verifie", // le KYC conditionne la publication (US-203)
    },
  });
  const provider = await prisma.user.create({
    data: {
      email: PROVIDER_EMAIL,
      tel: `+229${RUN}9`,
      role: "expert_digital", // non-chantier → pas de contrôle d'âge
      status: "active",
      country: "BJ",
      firstname: "E2E",
      lastname: "Prestataire",
      kycStatus: "verifie", // le KYC conditionne la candidature (US-203)
    },
  });
  clientId = client.id;
  providerId = provider.id;

  // upsert (pas create) : d'autres fichiers de test créent le même flag et tournent en
  // parallèle sur la base partagée.
  await prisma.featureFlag.upsert({
    where: { key_zone: { key: "psp_montage_valide", zone: "BJ" } },
    update: { enabled: true },
    create: { key: "psp_montage_valide", zone: "BJ", enabled: true },
  });
});

afterAll(async () => {
  await cleanup();
  delete process.env.ESCROW_STUB_AUTOCONFIRM;
});

describe("Cycle de vie complet d'une mission (création → clôture)", () => {
  it("E1 — le client publie une mission", async () => {
    authAs(clientId);
    const res = await missionPost(
      postReq({
        titre: "Site vitrine e-commerce",
        description: "Création d'un site vitrine avec espace d'administration pour une boutique.",
        domaine: "developpement",
        mode: "distance", // évite l'exigence de garant (présentiel/hybride)
        budgetType: "FIXED",
        budget: BUDGET,
        currency: "XOF",
        delaiJours: 15,
        professionalType: "EXPERT_DIGITAL",
        level: "Senior",
        status: "publiee",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("publiee");
    missionId = body.id;

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.clientId).toBe(clientId);
    expect(mission.riskLevel).toBe("low");
    expect(mission.currency).toBe("XOF");
  });

  it("E2 — le prestataire candidature à prix fixe", async () => {
    authAs(providerId);
    const res = await proposalPost(postReq({ montant: BUDGET, message: "Expert senior — je peux livrer sous 2 semaines." }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    proposalId = body.id;

    const proposal = await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(proposal.providerId).toBe(providerId);
    expect(proposal.montant).toBe(BUDGET);
  });

  it("E3 — le client accepte la candidature (les autres sont refusées)", async () => {
    authAs(clientId);
    const res = await acceptPost(postReq({}), {
      params: Promise.resolve({ id: missionId, proposalId }),
    });
    expect(res.status).toBe(200);

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("proposition_acceptee");
    const proposal = await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(proposal.status).toBe("acceptee");
  });

  it("E4 — le client génère le contrat fractionné en 2 jalons (somme = prix)", async () => {
    authAs(clientId);
    const res = await contractPost(postReq({ jalons: JALONS }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    contractId = body.id;

    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { id: contractId },
      include: { jalons: { orderBy: { ordre: "asc" } } },
    });
    expect(contract.jalons.length).toBe(2);
    jalonIds = contract.jalons.map((j) => j.id);
    const total = contract.jalons.reduce((s, j) => s + j.montant, 0);
    expect(total).toBe(BUDGET);
    expect((contract.termsSnapshot as { prix: number }).prix).toBe(BUDGET);
  });

  it("E5 — le prestataire signe en premier (1/2), le client contre-signe (2/2) → contrat_signe", async () => {
    // Certificats RSA-2048 des deux parties.
    authAs(providerId);
    const certP = await certPost(postReq({ commonName: "E2E Prestataire", email: PROVIDER_EMAIL, passphrase: PASSPHRASE }));
    expect(certP.status).toBe(201);
    providerCertId = (await certP.json()).data.id;

    authAs(clientId);
    const certC = await certPost(postReq({ commonName: "E2E Client", email: CLIENT_EMAIL, passphrase: PASSPHRASE }));
    expect(certC.status).toBe(201);
    clientCertId = (await certC.json()).data.id;

    // 1/2 — prestataire.
    authAs(providerId);
    const s1 = await signPost(postReq({ contractId, certificateId: providerCertId, passphrase: PASSPHRASE }));
    expect(s1.status).toBe(200);
    const c1 = await prisma.prestationContract.findUniqueOrThrow({ where: { id: contractId } });
    expect(c1.providerSignedAt).not.toBeNull();
    expect(c1.clientSignedAt).toBeNull();

    // 2/2 — client. Un client qui signe avant le prestataire serait refusé (provider_must_sign_first) ;
    // ici l'ordre est respecté.
    authAs(clientId);
    const s2 = await signPost(postReq({ contractId, certificateId: clientCertId, passphrase: PASSPHRASE }));
    expect(s2.status).toBe(200);
    const c2 = await prisma.prestationContract.findUniqueOrThrow({ where: { id: contractId } });
    expect(c2.clientSignedAt).not.toBeNull();

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("contrat_signe");
    // Contrat à jalons → aucun HOLD global (le paiement se finance jalon par jalon).
    const globalHold = await prisma.pspEscrowOperation.count({ where: { contractId, instructionType: "hold", jalonId: null } });
    expect(globalHold).toBe(0);
  });

  it("E6 — jalon 1 : financement (HOLD) + confirmation PSP → fonds_sous_sequestre", async () => {
    authAs(clientId);
    const res = await jalonHoldPost(postReq({}), {
      params: Promise.resolve({ id: missionId, jalonId: jalonIds[0] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pspRedirect).not.toBeNull();
    const ref = body.pspRedirect.reference as string;

    const before = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonIds[0] } });
    expect(before.status).toBe("en_attente");

    const confirmed = await operateVirtualPsp("authorize", ref);
    expect(confirmed.ok).toBe(true);

    const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonIds[0] } });
    expect(jalon.status).toBe("fonds_sous_sequestre");
    const op = await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { pspReference: ref } });
    expect(op.status).toBe("confirmed");
    expect(op.amount).toBe(100000);
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("fonds_sous_sequestre");
  });

  it("E7 — jalon 1 : livrable soumis par le prestataire", async () => {
    authAs(providerId);
    const d = await deliverablePost(deliverableForm(), {
      params: Promise.resolve({ id: missionId, jalonId: jalonIds[0] }),
    });
    expect(d.status).toBe(200);

    const s = await jalonSubmitPost(postReq({}), {
      params: Promise.resolve({ id: missionId, jalonId: jalonIds[0] }),
    });
    expect(s.status).toBe(200);

    const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonIds[0] } });
    expect(jalon.status).toBe("livrable_soumis");
  });

  it("E8 — jalon 1 : le client constate 100%, valide, RELEASE confirmé → jalon libere", async () => {
    authAs(clientId);
    // Pré-validation par preuve (2026-09-05) : le client valide la preuve du jalon avant la
    // libération (garde serveur assertProofsValidated).
    await prisma.missionAttachment.updateMany({
      where: { jalonId: jalonIds[0], appreciation: null },
      data: { appreciation: "validee", appreciatedById: clientId, appreciatedAt: new Date() },
    });
    const o = await observePost(postReq({ progress: 100 }), {
      params: Promise.resolve({ id: missionId, jalonId: jalonIds[0] }),
    });
    expect(o.status).toBe(200);

    const v = await validatePost(postReq({}), {
      params: Promise.resolve({ id: missionId, jalonId: jalonIds[0] }),
    });
    expect(v.status).toBe(200);

    // L'instruction RELEASE est créée `pending` — on la confirme côté PSP (webhook signé).
    const releaseOp = await prisma.pspEscrowOperation.findFirstOrThrow({
      where: { jalonId: jalonIds[0], instructionType: "release" },
    });
    const confirmed = await operateVirtualPsp("release", releaseOp.pspReference!);
    expect(confirmed.ok).toBe(true);

    const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonIds[0] } });
    expect(jalon.status).toBe("libere");
  });

  it("E9 — jalon 2 : même cycle (financement → livrable → validation → libération)", async () => {
    authAs(clientId);
    const h = await jalonHoldPost(postReq({}), {
      params: Promise.resolve({ id: missionId, jalonId: jalonIds[1] }),
    });
    expect(h.status).toBe(200);
    const holdRef = (await h.json()).pspRedirect.reference as string;
    expect((await operateVirtualPsp("authorize", holdRef)).ok).toBe(true);

    authAs(providerId);
    expect((await deliverablePost(deliverableForm(), { params: Promise.resolve({ id: missionId, jalonId: jalonIds[1] }) })).status).toBe(200);
    expect((await jalonSubmitPost(postReq({}), { params: Promise.resolve({ id: missionId, jalonId: jalonIds[1] }) })).status).toBe(200);

    authAs(clientId);
    // Pré-validation par preuve (2026-09-05) : le client valide la preuve du jalon avant la
    // libération (garde serveur assertProofsValidated).
    await prisma.missionAttachment.updateMany({
      where: { jalonId: jalonIds[1], appreciation: null },
      data: { appreciation: "validee", appreciatedById: clientId, appreciatedAt: new Date() },
    });
    expect((await observePost(postReq({ progress: 100 }), { params: Promise.resolve({ id: missionId, jalonId: jalonIds[1] }) })).status).toBe(200);
    expect((await validatePost(postReq({}), { params: Promise.resolve({ id: missionId, jalonId: jalonIds[1] }) })).status).toBe(200);

    const releaseOp = await prisma.pspEscrowOperation.findFirstOrThrow({
      where: { jalonId: jalonIds[1], instructionType: "release" },
    });
    expect((await operateVirtualPsp("release", releaseOp.pspReference!)).ok).toBe(true);

    const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonIds[1] } });
    expect(jalon.status).toBe("libere");
  });

  it("E10 — tous les jalons libérés → la mission est clôturée", async () => {
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("cloturee");

    // Tous les jalons du contrat sont payés.
    const liberes = await prisma.jalon.count({ where: { contractId, status: "libere" } });
    expect(liberes).toBe(2);

    // Traçabilité : 2 HOLD + 2 RELEASE confirmés via le chemin webhook.
    const ops = await prisma.pspEscrowOperation.findMany({ where: { contractId, status: "confirmed" } });
    const holds = ops.filter((o) => o.instructionType === "hold").length;
    const releases = ops.filter((o) => o.instructionType === "release").length;
    expect(holds).toBe(2);
    expect(releases).toBe(2);
  });
});
