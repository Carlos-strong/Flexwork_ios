/**
 * Test E2E du cycle de vie d'une mission EN MODE DEVIS (2026-09-02) — pendant de
 * mission-lifecycle.e2e.test.ts, qui emprunte le chemin prix fixe (proposals classiques +
 * jalons choisis librement à la génération du contrat). Ici la candidature passe par le vrai
 * circuit devis (budgetType = "QUOTE") :
 *
 *   mission QUOTE → devis (2 lignes) → validation du devis par le client → contrat
 *   fractionné en jalons (2, mêmes montants que le devis) → signatures →
 *   financement/livrable/validation/libération PAR JALON → clôture.
 *
 * Motif de ce test séparé : POST /api/missions/[id]/contract ne dérive PAS automatiquement
 * les `Jalon` du contrat depuis `devisData.lineItems` — le client fournit toujours `jalons`
 * explicitement dans le corps de la requête, que la mission soit FIXED ou QUOTE. Le chemin de
 * clôture (src/lib/psp-webhook.ts) est donc structurellement identique une fois le contrat
 * généré — ce test vérifie que c'est bien le cas en conditions réelles, pas supposé.
 *
 * Même pattern que mission-lifecycle.e2e.test.ts : vrais route handlers Next.js avec mock de
 * `auth()`, état vérifié en base (Prisma), confirmations PSP via la PSP virtuelle en mode
 * console (chemin webhook signé, jamais de confirmation optimiste).
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as missionPost } from "@/app/api/missions/route";
import { POST as devisPost } from "@/app/api/missions/[id]/devis/route";
import { POST as devisValidatePost } from "@/app/api/missions/[id]/proposals/[proposalId]/devis/validate/route";
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
const CLIENT_EMAIL = `e2e-devis-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-devis-provider-${RUN}@flexwork.test`;
const PASSPHRASE = "passphrase-e2e-devis-2026";

// Devis à 2 lignes, TVA et main d'œuvre nulles pour que totalTTC = 150000 exactement — les
// jalons du contrat (choisis manuellement, voir plus haut) reprennent les mêmes montants.
const LINE_ITEMS = [
  { description: "Fournitures — carrelage et colle", quantity: 1, unit: "forfait", unitPrice: 100000 },
  { description: "Pose et finitions", quantity: 1, unit: "forfait", unitPrice: 50000 },
];
const TOTAL_TTC = 150000;
const JALONS = [
  { titre: "Jalon 1 — Fournitures", montant: 100000 },
  { titre: "Jalon 2 — Pose et finitions", montant: 50000 },
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
  fd.append("note", "Preuve de livraison — test E2E devis");
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
      tel: `+229${RUN}6`,
      role: "client",
      status: "active",
      country: "BJ",
      firstname: "E2E",
      lastname: "ClientDevis",
      kycStatus: "verifie",
    },
  });
  const provider = await prisma.user.create({
    data: {
      email: PROVIDER_EMAIL,
      tel: `+229${RUN}7`,
      role: "expert_digital",
      status: "active",
      country: "BJ",
      firstname: "E2E",
      lastname: "PrestataireDevis",
      kycStatus: "verifie",
    },
  });
  clientId = client.id;
  providerId = provider.id;

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

describe("Cycle de vie complet d'une mission EN MODE DEVIS (QUOTE → clôture)", () => {
  it("D1 — le client publie une mission en mode devis (QUOTE)", async () => {
    authAs(clientId);
    const res = await missionPost(
      postReq({
        titre: "Rénovation salle de bain",
        description: "Dépose ancien carrelage, pose neuve, joints et finitions.",
        domaine: "btp",
        mode: "distance",
        budgetType: "QUOTE",
        currency: "XOF",
        delaiJours: 20,
        professionalType: "EXPERT_BTP",
        level: "Senior",
        status: "publiee",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    missionId = body.id;

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.budgetType).toBe("QUOTE");
    expect(mission.status).toBe("publiee");
  });

  it("D2 — le prestataire soumet un devis à 2 lignes → en_negociation", async () => {
    authAs(providerId);
    const res = await devisPost(postReq({ lineItems: LINE_ITEMS, delay: "10 jours", tvaRate: 0, laborCost: 0 }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    // POST /api/missions/[id]/devis renvoie { proposalId, round, devis } — contrairement à
    // POST /api/missions/[id]/proposals (prix fixe) qui renvoie directement { id }.
    proposalId = body.proposalId;

    const proposal = await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(proposal.status).toBe("en_negociation");
    expect(proposal.montant).toBe(TOTAL_TTC);
    expect((proposal.devisData as { totalTTC: number }).totalTTC).toBe(TOTAL_TTC);
  });

  it("D3 — le client valide le devis → devis_valide, mission proposition_acceptee", async () => {
    authAs(clientId);
    const res = await devisValidatePost(postReq({}), {
      params: Promise.resolve({ id: missionId, proposalId }),
    });
    expect(res.status).toBe(200);

    const proposal = await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(proposal.status).toBe("devis_valide");
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("proposition_acceptee");
  });

  it("D4 — le client génère le contrat fractionné en 2 jalons (somme = totalTTC du devis)", async () => {
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
    expect(total).toBe(TOTAL_TTC);
    // Le prix figé au contrat vient du devis validé (proposal.montant = totalTTC), pas d'un
    // montant recalculé indépendamment — même snapshot immuable que le mode prix fixe.
    expect((contract.termsSnapshot as { prix: number }).prix).toBe(TOTAL_TTC);
    expect((contract.termsSnapshot as { devis?: unknown }).devis).not.toBeNull();
  });

  it("D5 — le prestataire signe en premier (1/2), le client contre-signe (2/2) → contrat_signe", async () => {
    authAs(providerId);
    const certP = await certPost(postReq({ commonName: "E2E Prestataire Devis", email: PROVIDER_EMAIL, passphrase: PASSPHRASE }));
    expect(certP.status).toBe(201);
    providerCertId = (await certP.json()).data.id;

    authAs(clientId);
    const certC = await certPost(postReq({ commonName: "E2E Client Devis", email: CLIENT_EMAIL, passphrase: PASSPHRASE }));
    expect(certC.status).toBe(201);
    clientCertId = (await certC.json()).data.id;

    authAs(providerId);
    const s1 = await signPost(postReq({ contractId, certificateId: providerCertId, passphrase: PASSPHRASE }));
    expect(s1.status).toBe(200);

    authAs(clientId);
    const s2 = await signPost(postReq({ contractId, certificateId: clientCertId, passphrase: PASSPHRASE }));
    expect(s2.status).toBe(200);

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("contrat_signe");
  });

  it("D6 — jalon 1 : financement (HOLD) + confirmation PSP → fonds_sous_sequestre", async () => {
    authAs(clientId);
    const res = await jalonHoldPost(postReq({}), {
      params: Promise.resolve({ id: missionId, jalonId: jalonIds[0] }),
    });
    expect(res.status).toBe(200);
    const ref = (await res.json()).pspRedirect.reference as string;
    expect((await operateVirtualPsp("authorize", ref)).ok).toBe(true);

    const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonIds[0] } });
    expect(jalon.status).toBe("fonds_sous_sequestre");
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("fonds_sous_sequestre");
  });

  it("D7 — jalon 1 : livrable soumis, constaté 100%, validé, RELEASE confirmé → libere", async () => {
    authAs(providerId);
    expect((await deliverablePost(deliverableForm(), { params: Promise.resolve({ id: missionId, jalonId: jalonIds[0] }) })).status).toBe(200);
    expect((await jalonSubmitPost(postReq({}), { params: Promise.resolve({ id: missionId, jalonId: jalonIds[0] }) })).status).toBe(200);

    authAs(clientId);
    // Pré-validation par preuve (2026-09-05) : le client valide la preuve du jalon avant la
    // libération (garde serveur assertProofsValidated).
    await prisma.missionAttachment.updateMany({
      where: { jalonId: jalonIds[0], appreciation: null },
      data: { appreciation: "validee", appreciatedById: clientId, appreciatedAt: new Date() },
    });
    expect((await observePost(postReq({ progress: 100 }), { params: Promise.resolve({ id: missionId, jalonId: jalonIds[0] }) })).status).toBe(200);
    expect((await validatePost(postReq({}), { params: Promise.resolve({ id: missionId, jalonId: jalonIds[0] }) })).status).toBe(200);

    const releaseOp = await prisma.pspEscrowOperation.findFirstOrThrow({
      where: { jalonId: jalonIds[0], instructionType: "release" },
    });
    expect((await operateVirtualPsp("release", releaseOp.pspReference!)).ok).toBe(true);

    const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonIds[0] } });
    expect(jalon.status).toBe("libere");
    // Un seul jalon sur deux libéré : la mission ne clôture pas prématurément.
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).not.toBe("cloturee");
  });

  it("D8 — jalon 2 : même cycle complet (financement → livrable → validation → libération)", async () => {
    authAs(clientId);
    const h = await jalonHoldPost(postReq({}), { params: Promise.resolve({ id: missionId, jalonId: jalonIds[1] }) });
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

  it("D9 — tous les jalons libérés → la mission DEVIS est clôturée, l'avis devient possible", async () => {
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("cloturee");

    const liberes = await prisma.jalon.count({ where: { contractId, status: "libere" } });
    expect(liberes).toBe(2);

    const ops = await prisma.pspEscrowOperation.findMany({ where: { contractId, status: "confirmed" } });
    expect(ops.filter((o) => o.instructionType === "hold").length).toBe(2);
    expect(ops.filter((o) => o.instructionType === "release").length).toBe(2);

    // Chaîne complète jusqu'au bout : même garde que le mode prix fixe (review-rules.ts) —
    // canReviewAtStatus("cloturee") doit être vrai, sans quoi le lien "Donner un avis" de la
    // page mission resterait inatteignable pour ce mode aussi.
    const { canReviewAtStatus } = await import("@/lib/review-rules");
    expect(canReviewAtStatus(mission.status)).toBe(true);
  });
});
