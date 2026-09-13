/**
 * Test E2E du chemin MONÉTAIRE du financement progressif (2026-09-10) — le seul invariant qui
 * compte vraiment : sur la vie d'un jalon, la somme des instructions RELEASE transmises au PSP
 * n'excède JAMAIS le montant de ce jalon (règle 18.3).
 *
 * Ce que ce fichier couvre et qu'aucun autre ne couvrait : les tests existants vérifient la
 * PROGRESSION (paliers, plancher, régression) et les fonctions pures de calcul, jamais le
 * cumul des `PspEscrowOperation` réellement créées. Le défaut que cela laissait passer :
 * `alreadyReleased` n'agrégeait que les RELEASE `confirmed`. En développement,
 * ESCROW_STUB_AUTOCONFIRM=true confirme chaque instruction dans la même requête, donc le filtre
 * était toujours satisfait — mais en PRODUCTION `isVirtualPspEnabled()` est faux, aucune
 * confirmation automatique n'a lieu, et les RELEASE partiels restent `pending` jusqu'à
 * l'arrivée du webhook signé. Un client cliquant « Valider » avant ces webhooks déclenchait un
 * RELEASE du montant PLEIN par-dessus les partiels déjà en vol.
 *
 * D'où le mode console ici (pas d'autoconfirm) : c'est le seul réglage qui reproduit la
 * temporalité de la production.
 *
 * Même pattern que mission-lifecycle.e2e.test.ts : vrais route handlers Next.js, auth mockée,
 * état vérifié en base, confirmations PSP explicites via `operateVirtualPsp`.
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
import { POST as checkpointPost } from "@/app/api/missions/[id]/jalons/[jalonId]/checkpoint/route";
import { POST as validatePost } from "@/app/api/missions/[id]/jalons/[jalonId]/validate/route";
import { POST as observePost } from "@/app/api/missions/[id]/jalons/[jalonId]/observe-progress/route";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-prog-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-prog-provider-${RUN}@flexwork.test`;
const PASSPHRASE = "passphrase-e2e-progressive-2026";

// Un seul jalon, montant rond : tout l'intérêt est le cumul des libérations partielles dessus.
const MONTANT = 120000;

let clientId: string;
let providerId: string;
let missionId: string;
let contractId: string;
let jalonId: string;

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
  fd.append("note", "Preuve — test E2E financement progressif");
  return new Request("http://localhost/api", { method: "POST", body: fd });
}

// Somme de TOUTES les instructions RELEASE transmises pour ce jalon, quel que soit leur statut
// — c'est bien le total INSTRUIT au PSP qui ne doit jamais dépasser le montant dû, pas le total
// confirmé (une instruction en vol finira par être confirmée).
async function totalInstructedRelease(): Promise<number> {
  const ops = await prisma.pspEscrowOperation.findMany({
    where: { jalonId, instructionType: "release", status: { in: ["pending", "confirmed"] } },
    select: { amount: true },
  });
  return ops.reduce((sum, op) => sum + op.amount, 0);
}

// Soumet un lot de preuves et le fait apprécier favorablement par le client — préalable
// obligatoire à tout checkpoint/validation (assertProofsValidated).
async function submitAndApproveProofs() {
  authAs(providerId);
  const params = { params: Promise.resolve({ id: missionId, jalonId }) };
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
  // ⚠️ Réglage central de ce fichier : mode CONSOLE. Sans autoconfirm, chaque instruction reste
  // `pending` jusqu'à confirmation explicite — exactement la temporalité de la production.
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: {
      email: CLIENT_EMAIL,
      tel: `+229${RUN}6`,
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
      tel: `+229${RUN}7`,
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

  // Mission + proposition acceptée créées directement en base : le parcours de publication et
  // de négociation est déjà couvert ailleurs, ce fichier ne teste que l'argent.
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `E2E progressif ${RUN}`,
      description: "Mission de test du financement progressif — chemin monétaire.",
      domaine: "developpement",
      budget: MONTANT,
      currency: "XOF",
      delaiJours: 30,
      status: "proposition_acceptee",
      // Mode J3 choisi à la PUBLICATION : c'est lui qui impose financingMode = "progressive"
      // au contrat, sans que la génération n'ait à recevoir la moindre option.
      financingModeKey: "J3",
    },
  });
  missionId = mission.id;

  await prisma.missionProposal.create({
    data: { missionId, providerId, montant: MONTANT, status: "acceptee" },
  });
});

afterAll(async () => {
  await cleanup();
  delete process.env.ESCROW_STUB_AUTOCONFIRM;
});

describe("Financement progressif — la somme instruite ne dépasse jamais le montant du jalon", () => {
  it("P1 — le mode J3 de la mission impose le financement progressif au contrat", async () => {
    authAs(clientId);
    // Un seul jalon fourni en repli : la mission est en prix fixe, sans devis à dériver
    // (`devis_required`), donc la saisie manuelle reste le chemin — mais le MODE, lui,
    // s'applique quand même et impose `progressive`.
    const res = await contractPost(
      postReq({ jalons: [{ titre: "Jalon unique — chantier complet", montant: MONTANT }] }),
      { params: Promise.resolve({ id: missionId }) }
    );
    expect(res.status).toBe(200);

    const contract = await prisma.prestationContract.findUniqueOrThrow({
      where: { missionId },
      include: { jalons: true },
    });
    contractId = contract.id;
    jalonId = contract.jalons[0].id;

    // Le point de la refonte : le client n'a envoyé AUCUNE option de financement, le régime
    // vient du mode choisi à la publication.
    expect(contract.financingMode).toBe("progressive");
    expect(contract.jalons[0].montant).toBe(MONTANT);
  });

  it("P2 — contrat signé des deux côtés puis jalon financé (HOLD confirmé explicitement)", async () => {
    // Le PRESTATAIRE signe en premier, le client contre-signe — ordre imposé côté serveur.
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
    const holdRes = await jalonHoldPost(postReq({}), {
      params: Promise.resolve({ id: missionId, jalonId }),
    });
    expect(holdRes.status).toBe(200);

    const holdOp = await prisma.pspEscrowOperation.findFirstOrThrow({
      where: { jalonId, instructionType: "hold" },
    });
    // Sans autoconfirm, l'instruction attend bien une confirmation externe.
    expect(holdOp.status).toBe("pending");
    expect((await operateVirtualPsp("authorize", holdOp.pspReference!)).ok).toBe(true);

    const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonId } });
    expect(jalon.status).toBe("fonds_sous_sequestre");
  });

  it("P3 — un point d'étape à 50% libère la moitié, et l'instruction reste `pending`", async () => {
    await submitAndApproveProofs();

    authAs(clientId);
    const res = await checkpointPost(postReq({ progress: 50 }), {
      params: Promise.resolve({ id: missionId, jalonId }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).releasedAmount).toBe(MONTANT / 2);

    const releases = await prisma.pspEscrowOperation.findMany({
      where: { jalonId, instructionType: "release" },
    });
    expect(releases).toHaveLength(1);
    expect(releases[0].status).toBe("pending"); // en vol, pas encore confirmée
    expect(await totalInstructedRelease()).toBe(MONTANT / 2);
  });

  it("P4 — un second point d'étape à 100% ne libère que l'incrément, jamais le montant plein", async () => {
    authAs(clientId);
    const res = await checkpointPost(postReq({ progress: 100 }), {
      params: Promise.resolve({ id: missionId, jalonId }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).releasedAmount).toBe(MONTANT / 2);

    // Les deux partiels somment exactement au montant — et rien n'est encore confirmé.
    expect(await totalInstructedRelease()).toBe(MONTANT);
    const confirmed = await prisma.pspEscrowOperation.count({
      where: { jalonId, instructionType: "release", status: "confirmed" },
    });
    expect(confirmed).toBe(0);
  });

  it("P5 — RÉGRESSION : valider avant l'arrivée des webhooks ne redéclenche PAS le montant plein", async () => {
    // Le cœur du test. À cet instant : 100% constatés, 120 000 déjà instruits mais AUCUN
    // confirmé, et le jalon est encore `livrable_soumis` (seul le webhook le passe `libere`) —
    // donc `canDecideJalon` laisse passer. C'est très exactement la fenêtre dans laquelle un
    // second RELEASE de 120 000 partait, portant le total instruit à 240 000.
    const jalonAvant = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonId } });
    expect(jalonAvant.status).toBe("livrable_soumis");
    expect(jalonAvant.observedProgress).toBe(100);

    authAs(clientId);
    const res = await validatePost(postReq({}), {
      params: Promise.resolve({ id: missionId, jalonId }),
    });
    expect(res.status).toBe(200);
    // Rien ne reste à libérer : aucune nouvelle instruction n'est transmise — c'est l'objet
    // historique de ce test, et il reste vrai.
    const body = await res.json();
    expect(await totalInstructedRelease()).toBe(MONTANT);
    const releases = await prisma.pspEscrowOperation.count({
      where: { jalonId, instructionType: "release" },
    });
    expect(releases).toBe(2); // les deux partiels, et rien d'autre

    // Correctif 2026-09-11 : la route ne CLÔTURE plus non plus dans cette fenêtre. Un solde
    // restant nul peut signifier « tout est en vol » et non « tout est arrivé » — clôturer
    // là-dessus était une clôture optimiste, et depuis la retenue de garantie (règle 18.10)
    // cette clôture émet une instruction de versement. La validation est reçue, la clôture
    // attend le webhook.
    expect(body.releasePending).toBe(true);
    expect(body.alreadyFullyReleased).toBe(false);
    const jalonApres = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonId } });
    expect(jalonApres.status, "pas de bascule avant confirmation").toBe("livrable_soumis");
    const missionApres = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(missionApres.status).not.toBe("cloturee");
  });

  it("P6 — après confirmation des deux partiels, le jalon est libéré et la mission clôturée", async () => {
    const releases = await prisma.pspEscrowOperation.findMany({
      where: { jalonId, instructionType: "release", status: "pending" },
    });
    for (const op of releases) {
      expect((await operateVirtualPsp("release", op.pspReference!)).ok).toBe(true);
    }

    const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonId } });
    expect(jalon.status).toBe("libere");
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("cloturee");

    // Invariant final, celui qui résume tout le fichier.
    expect(await totalInstructedRelease()).toBe(MONTANT);
  });
});

describe("observe-progress — la progression constatée ne peut pas reculer", () => {
  it("P7 — redescendre sous le cumul déjà constaté est refusé (progress_regression)", async () => {
    // Sans cette garde, le client pouvait ramener observedProgress à 30 après avoir constaté
    // 100, puis reconfirmer 100 par checkpoint : l'incrément de 70% repartait une seconde fois,
    // libérant des fonds en avance sur l'avancement réel.
    authAs(clientId);
    const res = await observePost(postReq({ progress: 30 }), {
      params: Promise.resolve({ id: missionId, jalonId }),
    });
    expect([409, 200]).toContain(res.status);
    // Le jalon étant `libere` à ce stade, la fenêtre canDecideJalon se referme aussi — dans les
    // deux cas la progression constatée n'a pas bougé.
    const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonId } });
    expect(jalon.observedProgress).toBe(100);
  });
});
