/**
 * Test E2E du chemin de libération EN MODE AUTOCONFIRM (`ESCROW_STUB_AUTOCONFIRM="true"`).
 *
 * C'est le réglage du `.env` de développement — donc le chemin réellement emprunté en local et
 * en démo — et c'était, jusqu'au 2026-09-12, le SEUL que rien ne couvrait : toutes les suites
 * E2E existantes (mission-lifecycle, mission-lifecycle-devis, progressive-release,
 * retention-release) commencent par `delete process.env.ESCROW_STUB_AUTOCONFIRM` pour se placer
 * en mode console, qui reproduit la temporalité de la production. Elles ont raison de le faire,
 * mais l'angle mort était total.
 *
 * Le défaut qu'il couvre : en autoconfirm, `emitScopedRelease` confirme l'instruction DANS LE
 * MÊME APPEL. Le webhook fait donc passer le jalon à `libere` — et clôture la mission si c'était
 * le dernier — AVANT que `handleValidateDeliverable` n'ait écrit son statut d'attente. L'écriture
 * inconditionnelle de `valide` qui suivait écrasait alors `libere`, et le jalon devenait
 * définitivement inerte : `canDecideDeliverable` n'accepte que `livrable_soumis`, plus aucun
 * geste ne pouvait le reprendre, et la mission n'atteignait jamais `cloturee`.
 *
 * L'invariant vérifié tient en une phrase : quel que soit le MOMENT où la confirmation du PSP
 * arrive — dans la requête de validation (autoconfirm) ou bien plus tard (webhook réel) — l'état
 * final d'un jalon entièrement libéré est `libere`, et celui d'une mission dont tous les jalons
 * le sont est `cloturee`.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as contractPost } from "@/app/api/missions/[id]/contract/route";
import { POST as jalonHoldPost } from "@/app/api/missions/[id]/jalons/[jalonId]/hold/route";
import { POST as deliverablePost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/route";
import { POST as submitPost } from "@/app/api/missions/[id]/jalons/[jalonId]/submit/route";
import { POST as appreciatePost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/[attachmentId]/appreciate/route";
import { POST as observePost } from "@/app/api/missions/[id]/jalons/[jalonId]/observe-progress/route";
import { POST as validatePost } from "@/app/api/missions/[id]/jalons/[jalonId]/validate/route";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-autoconfirm-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-autoconfirm-provider-${RUN}@flexwork.test`;

const MONTANT_J1 = 300000;
const MONTANT_J2 = 200000;
const PRIX = MONTANT_J1 + MONTANT_J2;

let clientId: string;
let providerId: string;
let missionId: string;
let contractId: string;
let jalon1Id: string;
let jalon2Id: string;

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

function deliverableForm(): Request {
  const fd = new FormData();
  fd.append("category", "other");
  fd.append("note", "Preuve — test E2E autoconfirm");
  return new Request("http://localhost/api", { method: "POST", body: fd });
}

/** Finance un jalon. En autoconfirm, le HOLD est confirmé sans passage par la console PSP. */
async function fundJalon(jalonId: string) {
  authAs(clientId);
  const params = { params: Promise.resolve({ id: missionId, jalonId }) };
  expect((await jalonHoldPost(postReq({}), params)).status).toBe(200);
  const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonId } });
  expect(jalon.status, "le HOLD est confirmé dans la requête même").toBe("fonds_sous_sequestre");
}

/** Livrable → appréciation → constat 100 % → validation. AUCUNE confirmation PSP explicite. */
async function deliverAndValidate(jalonId: string) {
  const params = { params: Promise.resolve({ id: missionId, jalonId }) };

  authAs(providerId);
  expect((await deliverablePost(deliverableForm(), params)).status).toBe(200);
  expect((await submitPost(postReq({}), params)).status).toBe(200);

  authAs(clientId);
  const attachments = await prisma.missionAttachment.findMany({
    where: { missionId, jalonId },
    select: { id: true },
  });
  for (const a of attachments) {
    const res = await appreciatePost(postReq({ action: "validee" }), {
      params: Promise.resolve({ id: missionId, jalonId, attachmentId: a.id }),
    });
    expect(res.status).toBe(200);
  }
  expect((await observePost(postReq({ progress: 100 }), params)).status).toBe(200);
  expect((await validatePost(postReq({}), params)).status).toBe(200);
}

async function cleanup() {
  await prisma.progressCheckpoint.deleteMany({ where: { missionId } });
  await prisma.progressRejection.deleteMany({ where: { missionId } });
  await prisma.contractAuditEntry.deleteMany({ where: { contract: { missionId } } });
  await prisma.contractSignature.deleteMany({ where: { contract: { missionId } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contract: { missionId } } });
  await prisma.missionAttachment.deleteMany({ where: { missionId } });
  await prisma.jalon.deleteMany({ where: { contract: { missionId } } });
  await prisma.prestationContract.deleteMany({ where: { missionId } });
  await prisma.missionProposal.deleteMany({ where: { missionId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  // LE réglage sous test — à l'inverse de toutes les autres suites E2E, qui le suppriment.
  process.env.ESCROW_STUB_AUTOCONFIRM = "true";

  const client = await prisma.user.create({
    data: {
      email: CLIENT_EMAIL,
      tel: `+229${RUN}8`,
      role: "client",
      status: "active",
      country: "BJ",
      firstname: "E2E",
      lastname: "ClientAuto",
      kycStatus: "verifie",
    },
  });
  const provider = await prisma.user.create({
    data: {
      email: PROVIDER_EMAIL,
      tel: `+229${RUN}9`,
      role: "expert_digital",
      status: "active",
      country: "BJ",
      firstname: "E2E",
      lastname: "PrestataireAuto",
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

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `E2E autoconfirm ${RUN}`,
      description: "Mission de test du chemin autoconfirm.",
      domaine: "developpement",
      budget: PRIX,
      currency: "XOF",
      delaiJours: 30,
      status: "proposition_acceptee",
      financingModeKey: "J1",
    },
  });
  missionId = mission.id;

  await prisma.missionProposal.create({
    data: { missionId, providerId, montant: PRIX, status: "acceptee" },
  });
});

afterAll(async () => {
  await cleanup();
  delete process.env.ESCROW_STUB_AUTOCONFIRM;
});

describe("Libération en mode autoconfirm — la confirmation immédiate ne fige pas le jalon", () => {
  it("A1 — contrat à deux jalons", async () => {
    authAs(clientId);
    const res = await contractPost(
      postReq({
        jalons: [
          { titre: "Lot 1", montant: MONTANT_J1 },
          { titre: "Lot 2", montant: MONTANT_J2 },
        ],
      }),
      { params: Promise.resolve({ id: missionId }) }
    );
    expect(res.status).toBe(200);

    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { missionId },
      include: { jalons: { orderBy: { ordre: "asc" } } },
    });
    contractId = contract.id;
    jalon1Id = contract.jalons[0].id;
    jalon2Id = contract.jalons[1].id;

    // Les deux signatures sont posées directement : ce test porte sur le MOMENT de la
    // confirmation PSP, pas sur la chaîne de signature (couverte par
    // contract-signature-workflow.test.ts). Le financement d'un jalon les exige (garde
    // `contract_not_signed`).
    await prisma.prestationContract.update({
      where: { id: contractId },
      data: { clientSignedAt: new Date(), providerSignedAt: new Date() },
    });
    await prisma.mission.update({ where: { id: missionId }, data: { status: "contrat_signe" } });
  });

  it("A2 — un jalon validé finit `libere`, jamais bloqué en `valide`", async () => {
    await fundJalon(jalon1Id);
    await deliverAndValidate(jalon1Id);

    // Le cœur de la régression. Avant le correctif, ce jalon restait `valide` pour toujours :
    // le webhook l'avait passé `libere` pendant `emitScopedRelease`, et la route réécrivait
    // `valide` juste après.
    const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalon1Id } });
    expect(jalon.status, "la confirmation immédiate du PSP doit rester la dernière écriture").toBe("libere");

    const op = await prisma.pspEscrowOperation.findFirstOrThrow({
      where: { jalonId: jalon1Id, instructionType: "release" },
    });
    expect(op.status).toBe("confirmed");
    expect(op.amount).toBe(MONTANT_J1);
  });

  it("A3 — un seul jalon libéré sur deux ne clôture pas la mission", async () => {
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).not.toBe("cloturee");
  });

  it("A4 — le dernier jalon libéré clôture la mission", async () => {
    await fundJalon(jalon2Id);
    await deliverAndValidate(jalon2Id);

    const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalon2Id } });
    expect(jalon.status).toBe("libere");

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status, "tous les jalons libérés → clôture, même en autoconfirm").toBe("cloturee");

    const total = await prisma.pspEscrowOperation.aggregate({
      where: { contractId, instructionType: "release", status: "confirmed" },
      _sum: { amount: true },
    });
    expect(total._sum.amount).toBe(PRIX);
  });
});
