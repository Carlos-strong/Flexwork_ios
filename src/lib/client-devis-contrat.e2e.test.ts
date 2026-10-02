/**
 * Côté CLIENT — devis reçus, négociation, contrat et paiement selon le modèle choisi dans le
 * devis, par les vraies routes.
 *
 * Plan de tests (PLAN_TESTS_MODELE_PAIEMENT.md) : N02, C-N02, C-N04, C-K01, C-K04, C-K05,
 * C-K06, C-K09, C-K10, C-E01.
 *
 * Un prestataire par mission : la règle d'exclusivité interdit à un même prestataire deux
 * négociations actives en parallèle.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as missionPost } from "@/app/api/missions/route";
import { POST as devisPost } from "@/app/api/missions/[id]/devis/route";
import { POST as devisValidatePost } from "@/app/api/missions/[id]/proposals/[proposalId]/devis/validate/route";
import { POST as requestRevisionPost } from "@/app/api/missions/[id]/proposals/[proposalId]/devis/request-revision/route";
import { POST as contractPost } from "@/app/api/missions/[id]/contract/route";
import { POST as certPost } from "@/app/api/signature/certificate/route";
import { POST as signPost } from "@/app/api/signature/sign/route";
import { POST as deliverablePost } from "@/app/api/missions/[id]/deliverable/route";
import { POST as deliverableSubmitPost } from "@/app/api/missions/[id]/deliverable/submit/route";
import { POST as appreciatePost } from "@/app/api/missions/[id]/deliverable/[attachmentId]/appreciate/route";
import { POST as observePost } from "@/app/api/missions/[id]/observe-progress/route";
import { POST as releasePost } from "@/app/api/missions/[id]/escrow/release/route";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const PASSPHRASE = "passphrase-client-devis-2026";
const LONG = 120_000;
// Devis de référence : 100 000 + 50 000 HT, TVA 18 % → 177 000 TTC.
const LIGNES = [
  { description: "Fournitures", quantity: 1, unit: "forfait", unitPrice: 100_000 },
  { description: "Pose", quantity: 1, unit: "forfait", unitPrice: 50_000 },
];
const TTC = 177_000;

const ids = { client: "", clientCert: "" };
const presta: Record<string, string> = {};
const missionIds: string[] = [];

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}
const postReq = (body: unknown = {}) =>
  new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const at = (id: string) => ({ params: Promise.resolve({ id }) });
const atProposal = (id: string, proposalId: string) => ({ params: Promise.resolve({ id, proposalId }) });

async function expectOk(res: Response, label: string, codes = [200, 201]) {
  if (!codes.includes(res.status)) throw new Error(`${label} → HTTP ${res.status} : ${await res.clone().text()}`);
  return res;
}

async function publierDevis(titre: string) {
  authAs(ids.client);
  const res = await expectOk(
    await missionPost(
      postReq({
        titre: `${titre} ${RUN}`,
        description: "Mission en mode devis — test côté client du modèle de paiement.",
        domaine: "batiment",
        mode: "distance",
        currency: "XOF",
        delaiJours: 20,
        budgetType: "QUOTE",
        status: "publiee",
      })
    ),
    "publication"
  );
  const { id } = await res.json();
  missionIds.push(id);
  return id as string;
}

async function soumettreDevis(missionId: string, providerId: string, financingModeKey?: string) {
  authAs(providerId);
  const res = await expectOk(
    await devisPost(postReq({ lineItems: LIGNES, delay: "20 jours", tvaRate: 18, laborCost: 0, financingModeKey }), at(missionId)),
    "devis"
  );
  return (await res.json()).proposalId as string;
}

async function validerEtContracter(missionId: string, proposalId: string) {
  authAs(ids.client);
  await expectOk(await devisValidatePost(postReq(), atProposal(missionId, proposalId)), "validation du devis");
  const res = await expectOk(await contractPost(postReq(), at(missionId)), "génération du contrat");
  return prisma.prestationContract.findUniqueOrThrow({ where: { id: (await res.json()).id }, include: { jalons: { orderBy: { ordre: "asc" } } } });
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;
  let n = 0;
  const mk = (key: string, role: string) =>
    prisma.user.create({
      data: {
        email: `cd-${key}-${RUN}@flexwork.test`,
        tel: `+229${RUN}${++n}4`,
        status: "active",
        country: "BJ",
        kycStatus: "verifie",
        role: role as "client",
      },
    });
  ids.client = (await mk("client", "client")).id;
  for (const key of ["fixe", "j3", "j4", "s1", "legacy", "revision"]) presta[key] = (await mk(key, "expert_digital")).id;

  await prisma.featureFlag.upsert({
    where: { key_zone: { key: "psp_montage_valide", zone: "BJ" } },
    update: { enabled: true },
    create: { key: "psp_montage_valide", zone: "BJ", enabled: true },
  });
  authAs(ids.client);
  ids.clientCert = (await (await expectOk(await certPost(postReq({ commonName: "CD Client", email: `cd-client-${RUN}@flexwork.test`, passphrase: PASSPHRASE })), "certificat", [201])).json()).data.id;
}, LONG);

afterAll(async () => {
  const users = [ids.client, ...Object.values(presta)];
  const contrats = await prisma.prestationContract.findMany({ where: { missionId: { in: missionIds } }, select: { id: true } });
  const contractIds = contrats.map((c) => c.id);
  await prisma.pspEventLog.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contractAuditEntry.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contractSignature.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.missionNotification.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.digitalCertificate.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}, LONG);

describe("devis reçus et négociation", () => {
  it("N02 — la notification « Devis reçu » mentionne le modèle de paiement", async () => {
    const fixe = await publierDevis("CD Notif fixe");
    await soumettreDevis(fixe, presta.fixe, "F2");
    const j3 = await publierDevis("CD Notif J3");
    await soumettreDevis(j3, presta.j3, "J3");

    const notifFixe = await prisma.missionNotification.findFirstOrThrow({ where: { missionId: fixe, userId: ids.client, type: "devis_soumis" } });
    const notifJ3 = await prisma.missionNotification.findFirstOrThrow({ where: { missionId: j3, userId: ids.client, type: "devis_soumis" } });
    expect(notifFixe.message).toContain("paiement prix fixe");
    expect(notifJ3.message).toContain("paiement par jalons (Jalons + progression cumulée)");
  });

  it("C-N02 — le prestataire change de modèle à la révision : le client voit le nouveau", async () => {
    const missionId = await publierDevis("CD Révision");
    const proposalId = await soumettreDevis(missionId, presta.revision, "F2");
    authAs(ids.client);
    await expectOk(await requestRevisionPost(postReq({ message: "Pouvez-vous découper en jalons ?" }), atProposal(missionId, proposalId)), "demande de révision");
    await soumettreDevis(missionId, presta.revision, "J1");

    const proposal = await prisma.missionProposal.findUniqueOrThrow({
      where: { id: proposalId },
      include: { revisions: { orderBy: { roundNumber: "asc" } } },
    });
    expect((proposal.devisData as { financingModeKey: string }).financingModeKey).toBe("J1");
    expect(proposal.revisions.map((r) => (r.devisData as { financingModeKey: string }).financingModeKey)).toEqual(["F2", "J1"]);
  });
});

describe("contrat : le modèle du devis accepté fait foi", () => {
  it("C-K01 / C-K09 — devis à prix fixe : contrat sans jalon, mode F2 figé au contrat", async () => {
    const missionId = missionIds[0]; // mission « CD Notif fixe », devis F2 déjà soumis
    const proposal = await prisma.missionProposal.findFirstOrThrow({ where: { missionId } });
    const contract = await validerEtContracter(missionId, proposal.id);
    expect(contract.jalons).toHaveLength(0);
    expect(contract).toMatchObject({ financingMode: "lump_sum", retentionRate: 0 });
    expect((contract.termsSnapshot as { financingModeKey: string; prix: number })).toMatchObject({ financingModeKey: "F2", prix: TTC });
  });

  it("C-N04 — devis validé : le prestataire ne peut plus le modifier", async () => {
    authAs(presta.fixe);
    const res = await devisPost(postReq({ lineItems: LIGNES, delay: "20 jours", tvaRate: 18, laborCost: 0, financingModeKey: "J1" }), at(missionIds[0]));
    // Refus dès la garde d'éligibilité (la mission n'est plus ouverte une fois le devis validé),
    // avant même celle de la proposition close — dans les deux cas, rien ne change.
    expect(res.status).toBe(409);
    expect(["mission_not_open", "proposal_closed"]).toContain((await res.json()).error);
    const proposal = await prisma.missionProposal.findFirstOrThrow({ where: { missionId: missionIds[0] } });
    expect((proposal.devisData as { financingModeKey: string }).financingModeKey).toBe("F2");
  });

  it("C-K04 — devis J3 : financement progressif, jalons dérivés", async () => {
    const missionId = missionIds[1]; // mission « CD Notif J3 »
    const proposal = await prisma.missionProposal.findFirstOrThrow({ where: { missionId } });
    const contract = await validerEtContracter(missionId, proposal.id);
    expect(contract.financingMode).toBe("progressive");
    expect(contract.jalons.map((j) => j.montant)).toEqual([118_000, 59_000]);
  });

  it("C-K05 — devis J4 : retenue de garantie de 5 %", async () => {
    const missionId = await publierDevis("CD J4");
    const proposalId = await soumettreDevis(missionId, presta.j4, "J4");
    const contract = await validerEtContracter(missionId, proposalId);
    expect(contract.retentionRate).toBe(0.05);
    expect(contract.jalons).toHaveLength(2);
  });

  it("C-K06 — devis S1 : un seul séquestre (financement « upfront »)", async () => {
    const missionId = await publierDevis("CD S1");
    const proposalId = await soumettreDevis(missionId, presta.s1, "S1");
    const contract = await validerEtContracter(missionId, proposalId);
    expect(contract.fundingGranularity).toBe("upfront");
    expect(contract.jalons).toHaveLength(2);
  });

  it("C-K10 — devis antérieur sans modèle : repli sur le mode publié de la mission", async () => {
    const missionId = await publierDevis("CD Legacy");
    // Mission publiée avant la règle : elle portait le mode, pas le devis.
    await prisma.mission.update({ where: { id: missionId }, data: { financingModeKey: "J4" } });
    const proposalId = await soumettreDevis(missionId, presta.legacy);
    const proposal = await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } });
    const { financingModeKey: _ignore, ...devisAncien } = proposal.devisData as Record<string, unknown>;
    await prisma.missionProposal.update({ where: { id: proposalId }, data: { devisData: devisAncien as never } });

    const contract = await validerEtContracter(missionId, proposalId);
    expect(contract.retentionRate).toBe(0.05);
    expect((contract.termsSnapshot as { financingModeKey: string }).financingModeKey).toBe("J4");
  });
});

describe("paiement de bout en bout", () => {
  it(
    "C-E01 — devis à prix fixe : un séquestre de 177 000, une libération de 177 000, mission close",
    async () => {
      const missionId = missionIds[0];
      const contract = await prisma.prestationContract.findUniqueOrThrow({ where: { missionId } });

      // Signatures : le prestataire d'abord (1/2), le client ensuite (2/2) — qui déclenche le
      // séquestre automatique d'un contrat sans jalon.
      authAs(presta.fixe);
      const certP = (await (await expectOk(await certPost(postReq({ commonName: "CD Fixe", email: `cd-fixe-${RUN}@flexwork.test`, passphrase: PASSPHRASE })), "certificat", [201])).json()).data.id;
      await expectOk(await signPost(postReq({ contractId: contract.id, certificateId: certP, passphrase: PASSPHRASE })), "signature prestataire");
      authAs(ids.client);
      await expectOk(await signPost(postReq({ contractId: contract.id, certificateId: ids.clientCert, passphrase: PASSPHRASE })), "signature client");

      const hold = await prisma.pspEscrowOperation.findFirstOrThrow({ where: { contractId: contract.id, instructionType: "hold" } });
      expect(hold.amount).toBe(TTC);
      expect((await operateVirtualPsp("authorize", hold.pspReference!)).ok).toBe(true);

      // Livraison de la mission entière, appréciation, constat à 100 %, validation.
      authAs(presta.fixe);
      const fd = new FormData();
      fd.append("category", "other");
      fd.append("note", "Livraison complète");
      await expectOk(await deliverablePost(new Request("http://localhost/api", { method: "POST", body: fd }), at(missionId)), "livrable");
      await expectOk(await deliverableSubmitPost(postReq(), at(missionId)), "soumission");

      authAs(ids.client);
      const preuve = await prisma.missionAttachment.findFirstOrThrow({ where: { missionId, jalonId: null, appreciation: null } });
      await expectOk(await appreciatePost(postReq({ action: "validee" }), { params: Promise.resolve({ id: missionId, attachmentId: preuve.id }) }), "appréciation");
      await expectOk(await observePost(postReq({ progress: 100 }), at(missionId)), "constat");
      await expectOk(await releasePost(postReq(), at(missionId)), "validation");

      const releases = await prisma.pspEscrowOperation.findMany({ where: { contractId: contract.id, instructionType: "release" } });
      expect(releases.map((r) => r.amount)).toEqual([TTC]);
      expect((await operateVirtualPsp("release", releases[0].pspReference!)).ok).toBe(true);
      expect((await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })).status).toBe("cloturee");
      // Validation définitive tracée au niveau de la mission (contrat sans jalon).
      expect((await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })).clientValidatedById).toBe(ids.client);
    },
    LONG
  );
});
