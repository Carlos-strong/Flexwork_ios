/**
 * Parité des deux PORTÉES de validation (2026-09-11) — un jalon, ou la mission entière.
 *
 * Ces gestes (constat, point d'étape, rejet, validation) existaient en double : une route par
 * portée, structurellement identiques mais écrites séparément. Elles ont donc divergé, et pas
 * seulement sur des formulations : le correctif « ne pas clôturer sur des instructions PSP non
 * confirmées » avait été appliqué à la variante JALON seulement. La variante MISSION continuait
 * de clôturer de façon optimiste — même défaut, même fichier jumeau, corrigé d'un seul côté.
 *
 * Les deux portées partagent désormais leurs handlers (src/lib/deliverable-actions.ts). Ce
 * fichier vérifie la propriété qui manquait côté mission, sur le seul chemin où elle est
 * observable : financement PROGRESSIF sans jalon, où des libérations partielles sont déjà en
 * vol au moment où le client valide.
 *
 * Mode CONSOLE (pas d'autoconfirm) : sans lui, chaque instruction serait confirmée dans la même
 * requête et la fenêtre à tester n'existerait pas.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as contractPost } from "@/app/api/missions/[id]/contract/route";
import { POST as certPost } from "@/app/api/signature/certificate/route";
import { POST as signPost } from "@/app/api/signature/sign/route";
import { POST as deliverablePost } from "@/app/api/missions/[id]/deliverable/route";
import { POST as deliverableSubmitPost } from "@/app/api/missions/[id]/deliverable/submit/route";
import { POST as appreciatePost } from "@/app/api/missions/[id]/deliverable/[attachmentId]/appreciate/route";
import { POST as checkpointPost } from "@/app/api/missions/[id]/checkpoint/route";
import { POST as escrowReleasePost } from "@/app/api/missions/[id]/escrow/release/route";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-parity-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-parity-provider-${RUN}@flexwork.test`;
const PASSPHRASE = "passphrase-e2e-parity-2026";
const PRIX = 200000;

let clientId: string;
let providerId: string;
let missionId: string;
let contractId: string;

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}

function postReq(body: unknown): Request {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function proofForm(): Request {
  const fd = new FormData();
  fd.append("category", "other");
  fd.append("note", "Preuve — test E2E parité des portées");
  return new Request("http://localhost/api", { method: "POST", body: fd });
}

async function submitAndApproveProofs() {
  authAs(providerId);
  expect((await deliverablePost(proofForm(), { params: Promise.resolve({ id: missionId }) })).status).toBe(200);
  expect((await deliverableSubmitPost(postReq({}), { params: Promise.resolve({ id: missionId }) })).status).toBe(200);

  authAs(clientId);
  const attachments = await prisma.missionAttachment.findMany({
    where: { missionId, jalonId: null },
    select: { id: true },
  });
  for (const a of attachments) {
    const res = await appreciatePost(postReq({ action: "validee" }), {
      params: Promise.resolve({ id: missionId, attachmentId: a.id }),
    });
    expect(res.status, `appréciation ${a.id}`).toBe(200);
  }
}

async function pendingReleases() {
  return prisma.pspEscrowOperation.findMany({
    where: { contractId, instructionType: "release", status: "pending" },
  });
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}8`, role: "client", status: "active", country: "BJ", firstname: "E2E", lastname: "Client", kycStatus: "verifie" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}9`, role: "expert_digital", status: "active", country: "BJ", firstname: "E2E", lastname: "Prestataire", kycStatus: "verifie" },
  });
  clientId = client.id;
  providerId = provider.id;

  await prisma.featureFlag.upsert({
    where: { key_zone: { key: "psp_montage_valide", zone: "BJ" } },
    update: { enabled: true },
    create: { key: "psp_montage_valide", zone: "BJ", enabled: true },
  });

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `E2E parité portées ${RUN}`,
      description: "Mission de test de la parité jalon / mission entière.",
      domaine: "developpement",
      budget: PRIX,
      currency: "XOF",
      delaiJours: 30,
      status: "proposition_acceptee",
      // J3 impose `progressive`. Sans devis à dériver et sans jalon fourni au contrat, le
      // RÉGIME s'applique sur le prix total : exactement le contrat progressif SANS jalon.
      financingModeKey: "J3",
    },
  });
  missionId = mission.id;
  await prisma.missionProposal.create({
    data: { missionId, providerId, montant: PRIX, status: "acceptee" },
  });
});

afterAll(async () => {
  await prisma.progressCheckpoint.deleteMany({ where: { missionId } });
  await prisma.progressRejection.deleteMany({ where: { missionId } });
  await prisma.contractAuditEntry.deleteMany({ where: { contract: { missionId } } });
  await prisma.contractSignature.deleteMany({ where: { contract: { missionId } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contract: { missionId } } });
  await prisma.missionAttachment.deleteMany({ where: { missionId } });
  await prisma.prestationContract.deleteMany({ where: { missionId } });
  await prisma.missionProposal.deleteMany({ where: { missionId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.digitalCertificate.deleteMany({ where: { userId: { in: [clientId, providerId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
  delete process.env.ESCROW_STUB_AUTOCONFIRM;
});

describe("Portée MISSION — mêmes garanties que la portée jalon", () => {
  it("S1 — contrat progressif SANS jalon, signé, fonds séquestrés", async () => {
    authAs(clientId);
    // Aucun jalon fourni : le contrat reste non fractionné, mais garde le régime du mode.
    const res = await contractPost(postReq({}), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(200);

    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { missionId },
      include: { jalons: true },
    });
    contractId = contract.id;
    expect(contract.jalons).toHaveLength(0);
    expect(contract.financingMode).toBe("progressive");

    for (const [userId, email, name] of [
      [providerId, PROVIDER_EMAIL, "E2E Prestataire"],
      [clientId, CLIENT_EMAIL, "E2E Client"],
    ] as const) {
      authAs(userId);
      const certRes = await certPost(postReq({ commonName: name, email, passphrase: PASSPHRASE }));
      expect(certRes.status, `certificat ${name}`).toBe(201);
      const certificateId = (await certRes.json()).data.id;
      expect((await signPost(postReq({ contractId, certificateId, passphrase: PASSPHRASE }))).status).toBe(200);
    }

    // Le HOLD n'est pas demandé ici : la contre-signature du client le déclenche déjà
    // automatiquement (voir requestContractHold, src/lib/escrow.ts). Il reste à le confirmer.
    const holdOp = await prisma.pspEscrowOperation.findFirstOrThrow({
      where: { contractId, instructionType: "hold" },
    });
    expect(holdOp.status).toBe("pending");
    expect((await operateVirtualPsp("authorize", holdOp.pspReference!)).ok).toBe(true);
  });

  it("S2 — deux points d'étape libèrent 50 % puis 50 %, tout reste `pending`", async () => {
    await submitAndApproveProofs();

    authAs(clientId);
    const r1 = await checkpointPost(postReq({ progress: 50 }), { params: Promise.resolve({ id: missionId }) });
    expect(r1.status).toBe(200);
    expect((await r1.json()).releasedAmount).toBe(PRIX / 2);

    const r2 = await checkpointPost(postReq({ progress: 100 }), { params: Promise.resolve({ id: missionId }) });
    expect(r2.status).toBe(200);
    expect((await r2.json()).releasedAmount).toBe(PRIX / 2);

    expect(await pendingReleases()).toHaveLength(2);
  });

  it("S3 — RÉGRESSION : valider avant les webhooks ne clôture PAS la mission", async () => {
    // Le défaut corrigé : ce chemin posait `cloturee` alors qu'aucune libération n'était
    // confirmée. Si le PSP refusait ensuite les partiels, la mission était annoncée terminée
    // et le prestataire n'avait rien reçu. La variante JALON avait déjà la garde ; celle-ci non.
    authAs(clientId);
    const res = await escrowReleasePost(new Request("http://localhost/api", { method: "POST" }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.releasePending).toBe(true);
    expect(body.alreadyFullyReleased).toBe(false);

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).not.toBe("cloturee");

    // Et surtout : aucune instruction supplémentaire n'a été transmise.
    const releases = await prisma.pspEscrowOperation.count({
      where: { contractId, instructionType: "release" },
    });
    expect(releases).toBe(2);
  });

  it("S4 — une fois les partiels confirmés, la mission se clôture par le webhook", async () => {
    for (const op of await pendingReleases()) {
      expect((await operateVirtualPsp("release", op.pspReference!)).ok).toBe(true);
    }
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("cloturee");
  });

  it("S5 — revalider après clôture est idempotent, jamais une nouvelle instruction", async () => {
    authAs(clientId);
    const res = await escrowReleasePost(new Request("http://localhost/api", { method: "POST" }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).alreadyFullyReleased).toBe(true);

    const total = await prisma.pspEscrowOperation.aggregate({
      where: { contractId, instructionType: "release", status: { in: ["pending", "confirmed"] } },
      _sum: { amount: true },
    });
    expect(total._sum.amount).toBe(PRIX);
  });
});
