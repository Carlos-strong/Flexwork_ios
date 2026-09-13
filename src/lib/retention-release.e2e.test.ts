/**
 * Test E2E du chemin MONÉTAIRE de la retenue de garantie (mode J4, règle 18.10, 2026-09-11).
 *
 * L'invariant vérifié ici est comptable et tient en une ligne : sur la vie d'un contrat à
 * retenue, la somme de TOUT ce qui est instruit au PSP — les libérations jalon par jalon, puis
 * l'instruction finale de retenue — vaut EXACTEMENT le prix du contrat. Ni plus (le prestataire
 * serait surpayé), ni moins (un résidu resterait séquestré sans qu'aucune instruction ne vienne
 * jamais le chercher, ce qui est le mode de défaillance propre à une retenue : l'argent ne
 * disparaît pas, il s'immobilise).
 *
 * C'est pour cela que `totalRetentionAmount` somme les retenues JALON PAR JALON plutôt que
 * d'appliquer le taux au prix total : les deux calculs divergent de quelques francs dès que les
 * arrondis entrent en jeu, et cet écart est précisément le résidu immobilisé.
 *
 * Mode CONSOLE (pas d'autoconfirm), même réglage et même raison que
 * progressive-release.e2e.test.ts : c'est le seul qui reproduit la temporalité de la production,
 * où chaque instruction reste `pending` jusqu'à l'arrivée du webhook signé. C'est aussi ce qui
 * permet de vérifier que la mission ne se clôture PAS avant la confirmation de la retenue.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as contractPost } from "@/app/api/missions/[id]/contract/route";
import { POST as certPost } from "@/app/api/signature/certificate/route";
import { POST as signPost } from "@/app/api/signature/sign/route";
import { POST as jalonHoldPost } from "@/app/api/missions/[id]/jalons/[jalonId]/hold/route";
import { POST as deliverablePost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/route";
import { POST as submitPost } from "@/app/api/missions/[id]/jalons/[jalonId]/submit/route";
import { POST as appreciatePost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/[attachmentId]/appreciate/route";
import { POST as observePost } from "@/app/api/missions/[id]/jalons/[jalonId]/observe-progress/route";
import { POST as validatePost } from "@/app/api/missions/[id]/jalons/[jalonId]/validate/route";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { RETENTION_RATE_J4 } from "@/lib/financing-modes";
import { PROVIDER_PAYOUT_TYPES } from "@/lib/escrow-instructions";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-retenue-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-retenue-provider-${RUN}@flexwork.test`;
const PASSPHRASE = "passphrase-e2e-retenue-2026";

// Deux jalons de montants DIFFÉRENTS : une retenue calculée sur le prix total, puis répartie,
// ne retomberait pas sur la somme des retenues par jalon — c'est ce que ce découpage éprouve.
const MONTANT_J1 = 120000;
const MONTANT_J2 = 80000;
const PRIX = MONTANT_J1 + MONTANT_J2;

// Attendus explicites plutôt que recalculés avec la fonction testée : un test qui réutilise la
// formule qu'il vérifie ne vérifie rien.
const RETENUE_J1 = 6000; // 5 % de 120 000
const RETENUE_J2 = 4000; // 5 % de 80 000
const RETENUE_TOTALE = RETENUE_J1 + RETENUE_J2;

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
  fd.append("note", "Preuve — test E2E retenue de garantie");
  return new Request("http://localhost/api", { method: "POST", body: fd });
}

// Somme de TOUT ce qui sort vers le prestataire pour ce contrat : les libérations de jalons
// ET l'instruction finale de retenue, qui porte son propre type depuis le correctif du
// 2026-09-11 (EscrowInstructionType.retention_release).
async function totalInstructedRelease(): Promise<number> {
  const ops = await prisma.pspEscrowOperation.findMany({
    where: {
      contractId,
      instructionType: { in: PROVIDER_PAYOUT_TYPES },
      status: { in: ["pending", "confirmed"] },
    },
    select: { amount: true },
  });
  return ops.reduce((sum, op) => sum + op.amount, 0);
}

// Instruction finale de retenue, identifiée par son TYPE et non par son scope : le scope
// « contrat sans jalon » est aussi celui des libérations de médiation, les confondre était le
// défaut corrigé le 2026-09-11.
async function retentionOperation() {
  return prisma.pspEscrowOperation.findFirst({
    where: { contractId, instructionType: "retention_release" },
  });
}

async function missionStatus(): Promise<string> {
  const m = await prisma.mission.findUniqueOrThrow({ where: { id: missionId }, select: { status: true } });
  return m.status;
}

// Parcours complet d'un jalon jusqu'à sa libération confirmée : preuves → appréciation →
// constat à 100 % → validation → confirmation PSP. Retourne le montant réellement instruit.
async function releaseJalon(jalonId: string): Promise<number> {
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
    expect(res.status, `appréciation de la preuve ${a.id}`).toBe(200);
  }

  expect((await observePost(postReq({ progress: 100 }), params)).status).toBe(200);
  expect((await validatePost(postReq({}), params)).status).toBe(200);

  const op = await prisma.pspEscrowOperation.findFirstOrThrow({
    where: { jalonId, instructionType: "release" },
  });
  expect(op.status, "sans autoconfirm, la libération attend le webhook").toBe("pending");
  expect((await operateVirtualPsp("release", op.pspReference!)).ok).toBe(true);
  return op.amount;
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
  await prisma.digitalCertificate.deleteMany({ where: { userId: { in: [clientId, providerId] } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId] } } });
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: {
      email: CLIENT_EMAIL,
      tel: `+229${RUN}4`,
      role: "client",
      status: "active",
      country: "BJ",
      firstname: "E2E",
      lastname: "Client",
      kycStatus: "verifie",
    },
  });
  const provider = await prisma.user.create({
    data: {
      email: PROVIDER_EMAIL,
      tel: `+229${RUN}5`,
      role: "expert_digital",
      status: "active",
      country: "BJ",
      firstname: "E2E",
      lastname: "Prestataire",
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
      titre: `E2E retenue ${RUN}`,
      description: "Mission de test de la retenue de garantie — chemin monétaire.",
      domaine: "developpement",
      budget: PRIX,
      currency: "XOF",
      delaiJours: 30,
      status: "proposition_acceptee",
      // Mode J4 choisi à la PUBLICATION : c'est lui, et lui seul, qui pose le taux de retenue
      // au contrat — la génération ne reçoit aucune option de financement.
      financingModeKey: "J4",
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

describe("Retenue de garantie (J4) — le total instruit vaut exactement le prix du contrat", () => {
  it("R1 — le mode J4 de la mission pose le taux de retenue sur le contrat", async () => {
    authAs(clientId);
    // Mission à prix fixe sans devis : le DÉCOUPAGE vient de la saisie manuelle (`devis_required`),
    // mais le RÉGIME — ici la retenue — vient du mode, comme pour `financingMode` en J3.
    const res = await contractPost(
      postReq({
        jalons: [
          { titre: "Gros œuvre", montant: MONTANT_J1 },
          { titre: "Finitions", montant: MONTANT_J2 },
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

    expect(contract.retentionRate).toBe(RETENTION_RATE_J4);
    // J4 reste en libération unique par jalon : la retenue n'est pas un financement progressif.
    expect(contract.financingMode).toBe("lump_sum");
  });

  it("R2 — contrat signé des deux côtés, les deux jalons financés et confirmés", async () => {
    for (const [userId, email, name] of [
      [providerId, PROVIDER_EMAIL, "E2E Prestataire"],
      [clientId, CLIENT_EMAIL, "E2E Client"],
    ] as const) {
      authAs(userId);
      const certRes = await certPost(postReq({ commonName: name, email, passphrase: PASSPHRASE }));
      expect(certRes.status, `certificat ${name}`).toBe(201);
      const certificateId = (await certRes.json()).data.id;
      const signRes = await signPost(postReq({ contractId, certificateId, passphrase: PASSPHRASE }));
      expect(signRes.status, `signature ${name}`).toBe(200);
    }

    authAs(clientId);
    for (const jalonId of [jalon1Id, jalon2Id]) {
      const holdRes = await jalonHoldPost(postReq({}), {
        params: Promise.resolve({ id: missionId, jalonId }),
      });
      expect(holdRes.status, `HOLD du jalon ${jalonId}`).toBe(200);
      const holdOp = await prisma.pspEscrowOperation.findFirstOrThrow({
        where: { jalonId, instructionType: "hold" },
      });
      expect((await operateVirtualPsp("authorize", holdOp.pspReference!)).ok).toBe(true);
    }

    // La totalité du prix est séquestrée : la retenue n'est pas un « moins-perçu » du client,
    // c'est bien son argent bloqué, simplement versé plus tard au prestataire.
    const holds = await prisma.pspEscrowOperation.aggregate({
      where: { contractId, instructionType: "hold", status: "confirmed" },
      _sum: { amount: true },
    });
    expect(holds._sum.amount).toBe(PRIX);
  });

  it("R3 — la validation d'un jalon ne libère que son montant MOINS la retenue", async () => {
    const instruit = await releaseJalon(jalon1Id);
    expect(instruit).toBe(MONTANT_J1 - RETENUE_J1);

    // Le jalon est bien clos malgré une libération partielle : son seuil de clôture est le
    // plafond libérable, pas son montant — sinon il resterait `valide` pour toujours.
    const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalon1Id } });
    expect(jalon.status).toBe("libere");

    // Un seul jalon libéré sur deux : rien ne part encore en retenue.
    expect(await retentionOperation()).toBeNull();
    expect(await missionStatus()).not.toBe("cloturee");
  });

  it("R4 — le dernier jalon libéré déclenche l'instruction finale de retenue, sans clôturer", async () => {
    const instruit = await releaseJalon(jalon2Id);
    expect(instruit).toBe(MONTANT_J2 - RETENUE_J2);

    const retention = await retentionOperation();
    expect(retention, "l'instruction de retenue doit exister").not.toBeNull();
    expect(retention!.amount).toBe(RETENUE_TOTALE);
    expect(retention!.jalonId, "la retenue n'appartient à aucun jalon").toBeNull();
    expect(retention!.status).toBe("pending");

    // Le point central : tous les jalons sont payés, mais de l'argent est encore en vol — la
    // mission ne doit surtout pas être annoncée terminée avant la confirmation du PSP.
    expect(await missionStatus()).toBe("validee");
  });

  it("R5 — la mission ne se clôture qu'à la confirmation de la retenue", async () => {
    const retention = await retentionOperation();
    expect((await operateVirtualPsp("release", retention!.pspReference!)).ok).toBe(true);
    expect(await missionStatus()).toBe("cloturee");
  });

  it("R6 — INVARIANT : le total instruit vaut exactement le prix du contrat, sans résidu", async () => {
    expect(await totalInstructedRelease()).toBe(PRIX);

    // Et une seule instruction de retenue, jamais deux : `closeJalonFullyReleased` est atteint
    // par le webhook du dernier jalon ET appelable par POST .../validate.
    const retentionOps = await prisma.pspEscrowOperation.count({
      where: { contractId, instructionType: "retention_release" },
    });
    expect(retentionOps).toBe(1);
  });
});
