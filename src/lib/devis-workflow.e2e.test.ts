/**
 * Test E2E du workflow « mode devis » (missions budgetType = "QUOTE") (2026-08-31) :
 *
 *   mission QUOTE (sans montant) → soumission d'un devis (round 1) → demande de révision →
 *   re-soumission (round 2) → validation du devis → génération du contrat (devis figé) →
 *   signatures → financement/libération des jalons → clôture de la mission.
 *
 * Couvre la spécificité QUOTE (négociation de devis : exclusivité, rounds, demande de
 * révision consommée, TVA/main-d'œuvre, montant = totalTTC) puis réutilise le chemin post-
 * contrat déjà couvert par mission-lifecycle.e2e.test.ts pour prouver que la mission va
 * jusqu'à `cloturee`. Confirmations PSP via operateVirtualPsp (chemin webhook signé, US-503).
 *
 * Même pattern que les autres E2E : vrais route handlers Next.js + mock `auth()` + base réelle.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as missionPost } from "@/app/api/missions/route";
import { POST as devisPost } from "@/app/api/missions/[id]/devis/route";
import { POST as requestRevisionPost } from "@/app/api/missions/[id]/proposals/[proposalId]/devis/request-revision/route";
import { POST as validateDevisPost } from "@/app/api/missions/[id]/proposals/[proposalId]/devis/validate/route";
import { POST as acknowledgementPost } from "@/app/api/missions/[id]/acknowledgement/route";
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
const CLIENT_EMAIL = `devis-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `devis-provider-${RUN}@flexwork.test`;
const PASSPHRASE = "passphrase-devis-2026";

let clientId: string;
let providerId: string;
let missionId: string;
let proposalId: string;
let contractId: string;
let jalonIds: string[] = [];
let clientCertId: string;
let providerCertId: string;

// Devis round 1 — TVA 18% + main d'œuvre, le prix final (totalTTC) est ce que le contrat
// séquestrera : 236 000 XOF.
const DEVIS_R1 = {
  lineItems: [
    { description: "Conception graphique", quantity: 1, unit: "forfait", unitPrice: 120000 },
    { description: "Intégration", quantity: 1, unit: "forfait", unitPrice: 60000 },
  ],
  laborCost: 20000,
  tvaRate: 18,
  delay: "30 jours",
  notes: "Devis initial",
};
const TOTAL_TTC_R1 = 236000; // HT 200000 + TVA 36000

// Devis round 2 (révisé à la baisse) — totalTTC 194 700 XOF.
const DEVIS_R2 = {
  lineItems: [
    { description: "Conception graphique", quantity: 1, unit: "forfait", unitPrice: 100000 },
    { description: "Intégration", quantity: 1, unit: "forfait", unitPrice: 50000 },
  ],
  laborCost: 15000,
  tvaRate: 18,
  delay: "30 jours",
  notes: "Devis révisé suite à la demande du client",
};
const TOTAL_TTC_R2 = 194700; // HT 165000 + TVA 29700

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
  fd.append("note", "Preuve de livraison — devis E2E");
  return new Request("http://localhost/api", { method: "POST", body: fd });
}

async function cleanup() {
  await prisma.contractAuditEntry.deleteMany({ where: { contract: { missionId } } });
  await prisma.contractSignature.deleteMany({ where: { contract: { missionId } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contract: { missionId } } });
  await prisma.missionAttachment.deleteMany({ where: { missionId } });
  await prisma.jalon.deleteMany({ where: { contract: { missionId } } });
  await prisma.prestationContract.deleteMany({ where: { missionId } });
  await prisma.devisRevision.deleteMany({ where: { proposal: { missionId } } });
  await prisma.missionProposal.deleteMany({ where: { missionId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.digitalCertificate.deleteMany({ where: { userId: { in: [clientId, providerId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
  // ⚠️ PAS de suppression du flag psp_montage_valide (fixture partagé — voir escrow.test.ts).
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM; // mode console : confirmations PSP explicites

  const client = await prisma.user.create({
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}0`, role: "client", status: "active", country: "BJ", firstname: "Devis", lastname: "Client", kycStatus: "verifie" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}1`, role: "expert_digital", status: "active", country: "BJ", firstname: "Devis", lastname: "Prestataire", kycStatus: "verifie" },
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

describe("Workflow « mode devis » (QUOTE) — négociation → contrat → clôture", () => {
  it("D1 — le client publie une mission QUOTE sans montant fixé", async () => {
    authAs(clientId);
    const res = await missionPost(
      postReq({
        titre: "Refonte identité visuelle",
        description: "Refonte complète de l'identité visuelle d'une marque (logo, charte, déclinaisons).",
        domaine: "design",
        mode: "distance",
        budgetType: "QUOTE", // pas de montant : les prestataires proposent leur devis
        currency: "XOF",
        delaiJours: 20,
        professionalType: "EXPERT_DIGITAL",
        status: "publiee",
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("publiee");
    missionId = body.id;

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.budgetType).toBe("QUOTE");
    expect(mission.budget).toBe(0); // aucun montant exigé en mode devis
  });

  it("D2 — le prestataire soumet un devis (round 1) → en_negociation, montant = totalTTC", async () => {
    authAs(providerId);
    const res = await devisPost(postReq(DEVIS_R1), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    proposalId = body.proposalId;
    expect(body.round).toBe(1);
    expect(body.devis.totalTTC).toBe(TOTAL_TTC_R1);

    const proposal = await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(proposal.status).toBe("en_negociation");
    expect(proposal.montant).toBe(TOTAL_TTC_R1);
    expect(proposal.roundActuel).toBe(1);
    expect(proposal.delaiPropose).toBeNull(); // delay "30 jours" non entier → fallback mission
    const devis = proposal.devisData as { tvaRate: number; laborCost: number; totalHT: number };
    expect(devis.totalHT).toBe(200000);
    expect(devis.tvaRate).toBe(18);
    expect(devis.laborCost).toBe(20000);
  });

  it("D3 — le client demande une révision (message motivé)", async () => {
    authAs(clientId);
    const res = await requestRevisionPost(postReq({ message: "Merci de baisser le prix de la conception." }), {
      params: Promise.resolve({ id: missionId, proposalId }),
    });
    expect(res.status).toBe(200);

    const proposal = await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(proposal.revisionRequestedAt).not.toBeNull();
    expect(proposal.revisionRequestMessage).toContain("baisser");
  });

  it("D4 — le prestataire re-soumet (round 2) : la demande de révision est consommée", async () => {
    // Sans demande de révision, une re-soumission serait refusée (revision_not_requested).
    authAs(providerId);
    const res = await devisPost(postReq(DEVIS_R2), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.round).toBe(2);
    expect(body.devis.totalTTC).toBe(TOTAL_TTC_R2);

    const proposal = await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(proposal.montant).toBe(TOTAL_TTC_R2);
    expect(proposal.roundActuel).toBe(2);
    expect(proposal.revisionRequestedAt).toBeNull(); // consommée
    expect(proposal.revisionRequestMessage).toBeNull();
    // Historique : 2 révisions de devis enregistrées.
    const revisions = await prisma.devisRevision.count({ where: { proposalId } });
    expect(revisions).toBe(2);
  });

  it("D5 — le client valide le devis → devis_valide, mission proposition_acceptee", async () => {
    authAs(clientId);
    const res = await validateDevisPost(postReq({}), {
      params: Promise.resolve({ id: missionId, proposalId }),
    });
    expect(res.status).toBe(200);

    const proposal = await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(proposal.status).toBe("devis_valide");
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("proposition_acceptee");
  });

  it("D5b — l'accusé de réception fonctionne sur une mission à devis (devis_valide = retenue)", async () => {
    // La proposition retenue d'un mode devis reste « devis_valide » (jamais « acceptee »).
    // Avant le correctif, l'accusé de réception (US-404) filtrait sur status === "acceptee"
    // seul → 409 no_accepted_proposal sur toute mission QUOTE validée.
    authAs(clientId);
    const res = await acknowledgementPost(postReq({ acknowledgementType: "no_insurance" }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);

    const ack = await prisma.clientAcknowledgement.findFirstOrThrow({
      where: { missionId, clientId, acknowledgementType: "no_insurance" },
    });
    expect(ack.textSnapshot).toContain("assurance");
  });

  it("D6 — le client génère le contrat : le devis est figé (prix = totalTTC, snapshot.devis)", async () => {
    // Jalons sommés au totalTTC du devis validé (194 700 XOF) — somme validée côté serveur.
    const jalons = [
      { titre: "Conception graphique", montant: 120000 },
      { titre: "Intégration et déclinaisons", montant: 74700 },
    ];
    authAs(clientId);
    const res = await contractPost(postReq({ jalons }), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    contractId = body.id;

    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { id: contractId },
      include: { jalons: { orderBy: { ordre: "asc" } } },
    });
    const snap = contract.termsSnapshot as { prix: number; devis: { totalTTC: number; lineItems: unknown[] } };
    expect(snap.prix).toBe(TOTAL_TTC_R2);
    expect(snap.devis.totalTTC).toBe(TOTAL_TTC_R2);
    expect(snap.devis.lineItems.length).toBe(2);
    jalonIds = contract.jalons.map((j) => j.id);
    expect(contract.jalons.reduce((s, j) => s + j.montant, 0)).toBe(TOTAL_TTC_R2);
  });

  it("D7 — signatures 1/2 puis 2/2 → contrat_signe", async () => {
    authAs(providerId);
    const certP = await certPost(postReq({ commonName: "Devis Prestataire", email: PROVIDER_EMAIL, passphrase: PASSPHRASE }));
    providerCertId = (await certP.json()).data.id;
    expect((await signPost(postReq({ contractId, certificateId: providerCertId, passphrase: PASSPHRASE }))).status).toBe(200);

    authAs(clientId);
    const certC = await certPost(postReq({ commonName: "Devis Client", email: CLIENT_EMAIL, passphrase: PASSPHRASE }));
    clientCertId = (await certC.json()).data.id;
    expect((await signPost(postReq({ contractId, certificateId: clientCertId, passphrase: PASSPHRASE }))).status).toBe(200);

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("contrat_signe");
  });

  it("D8 — financement + livrable + validation des 2 jalons → clôture de la mission", async () => {
    const VALIDATE_JALON = async (jalonId: string, montant: number) => {
      // Financement (HOLD) + confirmation PSP.
      authAs(clientId);
      const h = await jalonHoldPost(postReq({}), { params: Promise.resolve({ id: missionId, jalonId }) });
      expect(h.status).toBe(200);
      const holdRef = (await h.json()).pspRedirect.reference as string;
      expect((await operateVirtualPsp("authorize", holdRef)).ok).toBe(true);
      const op = await prisma.pspEscrowOperation.findFirstOrThrow({ where: { pspReference: holdRef } });
      expect(op.amount).toBe(montant);

      // Livrable soumis par le prestataire.
      authAs(providerId);
      expect((await deliverablePost(deliverableForm(), { params: Promise.resolve({ id: missionId, jalonId }) })).status).toBe(200);
      expect((await jalonSubmitPost(postReq({}), { params: Promise.resolve({ id: missionId, jalonId }) })).status).toBe(200);

      // Constat 100% + validation + libération confirmée.
      authAs(clientId);
      // Pré-validation par preuve (2026-09-05) : le client valide la preuve du jalon avant la
      // libération (garde serveur assertProofsValidated).
      await prisma.missionAttachment.updateMany({
        where: { jalonId, appreciation: null },
        data: { appreciation: "validee", appreciatedById: clientId, appreciatedAt: new Date() },
      });
      expect((await observePost(postReq({ progress: 100 }), { params: Promise.resolve({ id: missionId, jalonId }) })).status).toBe(200);
      expect((await validatePost(postReq({}), { params: Promise.resolve({ id: missionId, jalonId }) })).status).toBe(200);
      const releaseOp = await prisma.pspEscrowOperation.findFirstOrThrow({ where: { jalonId, instructionType: "release" } });
      expect((await operateVirtualPsp("release", releaseOp.pspReference!)).ok).toBe(true);
    };

    await VALIDATE_JALON(jalonIds[0], 120000);
    await VALIDATE_JALON(jalonIds[1], 74700);

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("cloturee");
    const liberes = await prisma.jalon.count({ where: { contractId, status: "libere" } });
    expect(liberes).toBe(2);
  });
});
