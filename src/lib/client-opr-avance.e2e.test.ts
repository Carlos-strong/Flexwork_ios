/**
 * Côté CLIENT — vérification OPR, cas avancés, par les vraies routes.
 *
 * Plan de tests (PLAN_TESTS_MODELE_PAIEMENT.md) :
 *   - V-J10 : financement progressif (J3) en OPR — le client confirme un point d'étape égal au
 *     taux vérifié par le responsable, jamais au-delà ;
 *   - V-J11 : contrat SANS jalon (mission entière) — même parcours vérifier → transmettre →
 *     valider, via les routes de portée mission ;
 *   - V-J12 : acceptation tacite en OPR sans transmission — le délai court depuis la soumission,
 *     le prestataire n'est pas otage d'un responsable inactif.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as jalonHoldPost } from "@/app/api/missions/[id]/jalons/[jalonId]/hold/route";
import { POST as jalonDeliverablePost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/route";
import { POST as jalonSubmitPost } from "@/app/api/missions/[id]/jalons/[jalonId]/submit/route";
import { POST as jalonAppreciatePost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/[attachmentId]/appreciate/route";
import { POST as jalonObservePost } from "@/app/api/missions/[id]/jalons/[jalonId]/observe-progress/route";
import { POST as jalonCheckpointPost } from "@/app/api/missions/[id]/jalons/[jalonId]/checkpoint/route";
import { POST as escrowHoldPost } from "@/app/api/missions/[id]/escrow/hold/route";
import { POST as deliverablePost } from "@/app/api/missions/[id]/deliverable/route";
import { POST as deliverableSubmitPost } from "@/app/api/missions/[id]/deliverable/submit/route";
import { POST as appreciatePost } from "@/app/api/missions/[id]/deliverable/[attachmentId]/appreciate/route";
import { POST as observePost } from "@/app/api/missions/[id]/observe-progress/route";
import { POST as verificationPost } from "@/app/api/missions/[id]/deliverable/verification/route";
import { POST as releasePost } from "@/app/api/missions/[id]/escrow/release/route";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { runTacitAcceptanceSweep } from "@/lib/tacit-acceptance";
import { prisma } from "@/lib/db";
import { givePayoutAccount } from "@/test/payout-fixture";

const RUN = Date.now();
const MONTANT = 100_000;
const DAY = 24 * 60 * 60 * 1000;
let clientId = "";
let providerId = "";
let managerId = "";
const missionIds: string[] = [];
let seq = 0;

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}
const postReq = (body: unknown = {}) =>
  new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const at = (id: string) => ({ params: Promise.resolve({ id }) });
const atJalon = (id: string, jalonId: string) => ({ params: Promise.resolve({ id, jalonId }) });
function proofForm(): Request {
  const fd = new FormData();
  fd.append("category", "other");
  fd.append("note", "Preuve — OPR avancé");
  return new Request("http://localhost/api", { method: "POST", body: fd });
}
async function expectOk(res: Response, label: string) {
  if (res.status !== 200 && res.status !== 201) throw new Error(`${label} → HTTP ${res.status} : ${await res.clone().text()}`);
  return res;
}

/** Contrat OPR signé, responsable désigné ; avec un jalon, ou sans jalon (mission entière). */
async function contratOpr(opts: { avecJalon: boolean; progressif?: boolean }) {
  seq++;
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `OPR avancé ${RUN}-${seq}`,
      description: "Mission en vérification OPR — cas avancés côté client.",
      domaine: "batiment",
      budget: MONTANT,
      currency: "XOF",
      delaiJours: 30,
      riskLevel: "low",
      status: "contrat_signe",
      validationMode: "opr",
      siteManagerId: managerId,
    },
  });
  missionIds.push(mission.id);
  const contract = await prisma.prestationContract.create({
    data: {
      missionId: mission.id,
      clientId,
      providerId,
      termsSnapshot: { prix: MONTANT, devise: "XOF" },
      currentHash: `hash-opr-avance-${RUN}-${seq}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      validationMode: "opr",
      siteManagerId: managerId,
      financingMode: opts.progressif ? "progressive" : "lump_sum",
      ...(opts.avecJalon ? { jalons: { create: [{ ordre: 1, titre: "Gros œuvre", montant: MONTANT }] } } : {}),
    },
    include: { jalons: true },
  });
  return { missionId: mission.id, contractId: contract.id, jalonId: contract.jalons[0]?.id ?? null };
}

async function confirmerHold(contractId: string) {
  const hold = await prisma.pspEscrowOperation.findFirstOrThrow({ where: { contractId, instructionType: "hold", status: "pending" } });
  expect((await operateVirtualPsp("authorize", hold.pspReference!)).ok).toBe(true);
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;
  const mk = (key: string, role: string, n: number) =>
    prisma.user.create({
      data: { email: `coa-${key}-${RUN}@flexwork.test`, tel: `+229${RUN}8${n}`, role: role as "client", status: "active", country: "BJ", kycStatus: "verifie" },
    });
  clientId = (await mk("client", "client", 0)).id;
  providerId = (await mk("presta", "artisan", 1)).id;
  await givePayoutAccount(providerId);
  managerId = (await mk("rc", "responsable_chantier", 2)).id;
  await prisma.featureFlag.upsert({
    where: { key_zone: { key: "psp_montage_valide", zone: "BJ" } },
    update: { enabled: true },
    create: { key: "psp_montage_valide", zone: "BJ", enabled: true },
  });
});

afterAll(async () => {
  const contrats = await prisma.prestationContract.findMany({ where: { missionId: { in: missionIds } }, select: { id: true } });
  const contractIds = contrats.map((c) => c.id);
  await prisma.missionNotification.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: [clientId, providerId, managerId] } } });
  await prisma.progressCheckpoint.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.missionAttachment.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.payable.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.pspEventLog.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId, managerId] } } });
});

describe("V-J10 — financement progressif (J3) en OPR", () => {
  it("le client confirme le taux vérifié, jamais au-delà — et c'est ce point d'étape qui paie", async () => {
    const { missionId, contractId, jalonId } = await contratOpr({ avecJalon: true, progressif: true });
    authAs(clientId);
    await expectOk(await jalonHoldPost(postReq(), atJalon(missionId, jalonId!)), "financement du jalon");
    await confirmerHold(contractId);

    authAs(providerId);
    await expectOk(await jalonDeliverablePost(proofForm(), atJalon(missionId, jalonId!)), "preuve");
    await expectOk(await jalonSubmitPost(postReq(), atJalon(missionId, jalonId!)), "soumission");

    // Le responsable apprécie la preuve et constate 50 % — aucun versement.
    authAs(managerId);
    const preuve = await prisma.missionAttachment.findFirstOrThrow({ where: { jalonId, appreciation: null } });
    await expectOk(
      await jalonAppreciatePost(postReq({ action: "validee" }), { params: Promise.resolve({ id: missionId, jalonId: jalonId!, attachmentId: preuve.id }) }),
      "appréciation"
    );
    await expectOk(await jalonObservePost(postReq({ progress: 50 }), atJalon(missionId, jalonId!)), "constat 50 %");
    expect(await prisma.pspEscrowOperation.count({ where: { contractId, instructionType: "release" } })).toBe(0);

    // Le client ne va pas au-delà de ce que le responsable a constaté…
    authAs(clientId);
    const auDela = await jalonCheckpointPost(postReq({ progress: 60 }), atJalon(missionId, jalonId!));
    expect(auDela.status).toBe(409);
    expect((await auDela.json()).error).toBe("progress_not_verified");

    // …et confirmer exactement le taux vérifié libère la moitié du jalon.
    await expectOk(await jalonCheckpointPost(postReq({ progress: 50 }), atJalon(missionId, jalonId!)), "point d'étape 50 %");
    const releases = await prisma.pspEscrowOperation.findMany({ where: { contractId, instructionType: "release" } });
    expect(releases.map((r) => r.amount)).toEqual([MONTANT / 2]);
  });
});

describe("V-J11 — OPR sur un contrat sans jalon (mission entière)", () => {
  it("vérifier → transmettre → valider, par les routes de portée mission", async () => {
    const { missionId, contractId } = await contratOpr({ avecJalon: false });
    authAs(clientId);
    await expectOk(await escrowHoldPost(postReq(), at(missionId)), "financement");
    await confirmerHold(contractId);

    authAs(providerId);
    await expectOk(await deliverablePost(proofForm(), at(missionId)), "livrable");
    await expectOk(await deliverableSubmitPost(postReq(), at(missionId)), "soumission");

    // Avant transmission : le client ne libère pas, et ne vérifie pas à la place du responsable.
    authAs(clientId);
    expect((await (await releasePost(postReq(), at(missionId))).json()).error).toBe("verification_required");
    expect((await (await observePost(postReq({ progress: 100 }), at(missionId))).json()).error).toBe("site_manager_only");

    // Le responsable vérifie et transmet.
    authAs(managerId);
    const preuve = await prisma.missionAttachment.findFirstOrThrow({ where: { missionId, jalonId: null, appreciation: null } });
    await expectOk(await appreciatePost(postReq({ action: "validee" }), { params: Promise.resolve({ id: missionId, attachmentId: preuve.id }) }), "appréciation");
    await expectOk(await observePost(postReq({ progress: 100 }), at(missionId)), "constat");
    await expectOk(await verificationPost(postReq({ note: "Livraison conforme." }), at(missionId)), "transmission");
    expect(await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })).toMatchObject({
      verifiedById: managerId,
      verificationNote: "Livraison conforme.",
    });

    // Le client valide définitivement : la libération part, la validation est tracée.
    authAs(clientId);
    await expectOk(await releasePost(postReq(), at(missionId)), "validation définitive");
    const releases = await prisma.pspEscrowOperation.findMany({ where: { contractId, instructionType: "release" } });
    expect(releases.map((r) => r.amount)).toEqual([MONTANT]);
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })).clientValidatedById).toBe(clientId);
  });
});

describe("V-J12 — acceptation tacite en OPR sans transmission", () => {
  it("livrable soumis il y a 8 jours, jamais vérifié : payé quand même, sans validation client tracée", async () => {
    const { contractId, jalonId } = await contratOpr({ avecJalon: true });
    // Jalon financé (HOLD confirmé) et soumis il y a 8 jours ; le responsable n'a rien transmis.
    await prisma.pspEscrowOperation.create({
      data: {
        contractId,
        jalonId,
        pspName: "psp-virtuelle",
        pspReference: `hold_opr_tacite_${RUN}`,
        amount: MONTANT,
        currency: "XOF",
        instructionType: "hold",
        status: "confirmed",
        pspConfirmedAt: new Date(),
      },
    });
    await prisma.jalon.update({
      where: { id: jalonId! },
      data: { status: "livrable_soumis", submittedAt: new Date(Date.now() - 8 * DAY) },
    });

    const report = await runTacitAcceptanceSweep();
    expect(report.skipped.some((s) => s.jalonId === jalonId)).toBe(false);
    const releases = await prisma.pspEscrowOperation.findMany({ where: { contractId, jalonId, instructionType: "release" } });
    expect(releases.map((r) => r.amount)).toEqual([MONTANT]);
    // Ni vérification ni validation : l'acceptation tacite n'est le geste de personne.
    expect(await prisma.jalon.findUniqueOrThrow({ where: { id: jalonId! } })).toMatchObject({
      verifiedAt: null,
      clientValidatedById: null,
    });
  });
});
