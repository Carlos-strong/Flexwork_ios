/**
 * Mode de vérification OPR sur des JALONS (2026-10-01) — par les vraies routes.
 *
 *   prestataire soumet → responsable apprécie les preuves, constate l'avancement, TRANSMET
 *   → client valide définitivement → libération.
 *
 * Et ce qui doit rester impossible : le client qui vérifie à la place du responsable, le client
 * qui libère avant la transmission, le responsable qui libère, un tiers qui transmet.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as jalonHoldPost } from "@/app/api/missions/[id]/jalons/[jalonId]/hold/route";
import { POST as deliverablePost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/route";
import { POST as jalonSubmitPost } from "@/app/api/missions/[id]/jalons/[jalonId]/submit/route";
import { POST as appreciatePost } from "@/app/api/missions/[id]/jalons/[jalonId]/deliverable/[attachmentId]/appreciate/route";
import { POST as observePost } from "@/app/api/missions/[id]/jalons/[jalonId]/observe-progress/route";
import { POST as verificationPost } from "@/app/api/missions/[id]/jalons/[jalonId]/verification/route";
import { POST as validatePost } from "@/app/api/missions/[id]/jalons/[jalonId]/validate/route";
import { POST as rejectPost } from "@/app/api/missions/[id]/jalons/[jalonId]/reject/route";
import { GET as attachmentsGet } from "@/app/api/missions/[id]/jalons/[jalonId]/attachments/route";
import { PATCH as siteManagerPatch } from "@/app/api/missions/[id]/site-manager/route";
import { POST as missionPost } from "@/app/api/missions/route";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const MONTANT = 100_000;

let clientId = "";
let providerId = "";
let managerId = "";
let intrusId = "";
let missionId = "";
let contractId = "";
let jalonId = "";
let jalon2Id = "";
let categorieOprId = "";
let categorieSansOprId = "";
const brouillons: string[] = [];

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}
const postReq = (body: unknown = {}) =>
  new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const at = () => ({ params: Promise.resolve({ id: missionId, jalonId }) });
const atProof = (attachmentId: string) => ({ params: Promise.resolve({ id: missionId, jalonId, attachmentId }) });

function proofForm(): Request {
  const fd = new FormData();
  fd.append("category", "other");
  fd.append("note", "Preuve de livraison — OPR E2E");
  return new Request("http://localhost/api", { method: "POST", body: fd });
}

async function soumettreLivrable(): Promise<string> {
  authAs(providerId);
  expect((await deliverablePost(proofForm(), at())).status).toBe(200);
  expect((await jalonSubmitPost(postReq(), at())).status).toBe(200);
  const preuve = await prisma.missionAttachment.findFirstOrThrow({
    where: { jalonId, appreciation: null },
    orderBy: { createdAt: "desc" },
  });
  return preuve.id;
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const mk = (suffix: string, role: string, n: number) =>
    prisma.user.create({
      data: { email: `e2e-opr-${suffix}-${RUN}@flexwork.test`, tel: `+229${RUN}7${n}`, role: role as "client", status: "active", country: "BJ", kycStatus: "verifie" },
    });
  const [c, p, m, x] = await Promise.all([
    mk("client", "client", 0),
    mk("presta", "artisan", 1),
    mk("rc", "responsable_chantier", 2),
    mk("intrus", "responsable_chantier", 3),
  ]);
  clientId = c.id;
  providerId = p.id;
  managerId = m.id;
  intrusId = x.id;

  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `Chantier OPR ${RUN}`,
      description: "Mission à jalons vérifiée par un responsable de chantier.",
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
  missionId = mission.id;

  const contract = await prisma.prestationContract.create({
    data: {
      missionId,
      clientId,
      providerId,
      termsSnapshot: { prix: MONTANT, devise: "XOF" },
      currentHash: `hash-opr-${RUN}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      validationMode: "opr",
      siteManagerId: managerId,
      jalons: {
        create: [
          { ordre: 1, titre: "Gros œuvre", montant: MONTANT },
          { ordre: 2, titre: "Finitions", montant: MONTANT },
        ],
      },
    },
    include: { jalons: { orderBy: { ordre: "asc" } } },
  });
  contractId = contract.id;
  jalonId = contract.jalons[0].id;
  jalon2Id = contract.jalons[1].id;

  categorieOprId = (await prisma.categorie.create({ data: { libelle: `OPR autorisée ${RUN}`, allowsOprVerification: true } })).id;
  categorieSansOprId = (await prisma.categorie.create({ data: { libelle: `OPR non proposée ${RUN}` } })).id;

  authAs(clientId);
  const hold = await jalonHoldPost(postReq(), at());
  expect(hold.status).toBe(200);
  expect((await operateVirtualPsp("authorize", (await hold.json()).pspRedirect.reference)).ok).toBe(true);
});

afterAll(async () => {
  await prisma.mission.deleteMany({ where: { id: { in: brouillons } } });
  await prisma.categorie.deleteMany({ where: { id: { in: [categorieOprId, categorieSansOprId] } } });
  await prisma.contractAuditEntry.deleteMany({ where: { contractId } });
  await prisma.missionNotification.deleteMany({ where: { missionId } });
  await prisma.notification.deleteMany({ where: { missionId } }).catch(() => {});
  await prisma.progressCheckpoint.deleteMany({ where: { missionId } });
  await prisma.progressRejection.deleteMany({ where: { missionId } });
  await prisma.missionAttachment.deleteMany({ where: { missionId } });
  await prisma.payable.deleteMany({ where: { contractId } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contractId } });
  await prisma.jalon.deleteMany({ where: { contractId } });
  await prisma.prestationContract.deleteMany({ where: { id: contractId } });
  await prisma.mission.deleteMany({ where: { id: missionId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId, managerId, intrusId] } } });
});

describe("OPR sur un jalon — vérification puis validation définitive", () => {
  let preuveId = "";

  it("le responsable désigné voit les preuves ; un responsable non désigné non", async () => {
    preuveId = await soumettreLivrable();
    authAs(managerId);
    expect((await attachmentsGet(new Request("http://localhost/api"), at())).status).toBe(200);
    authAs(intrusId);
    expect((await attachmentsGet(new Request("http://localhost/api"), at())).status).toBe(404);
  });

  it("le client ne vérifie pas lui-même : appréciation et constat lui sont refusés", async () => {
    authAs(clientId);
    const appreciation = await appreciatePost(postReq({ action: "validee" }), atProof(preuveId));
    expect(appreciation.status).toBe(409);
    expect((await appreciation.json()).error).toBe("site_manager_only");
    const constat = await observePost(postReq({ progress: 100 }), at());
    expect((await constat.json()).error).toBe("site_manager_only");
  });

  it("le client ne libère pas avant la transmission du responsable", async () => {
    authAs(clientId);
    const res = await validatePost(postReq(), at());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("verification_required");
  });

  it("le responsable ne transmet qu'une vérification complète (preuves validées, 100 %)", async () => {
    authAs(managerId);
    expect((await (await verificationPost(postReq(), at())).json()).error).toBe("progress_incomplete");

    expect((await appreciatePost(postReq({ action: "validee" }), atProof(preuveId))).status).toBe(200);
    expect((await observePost(postReq({ progress: 100 }), at())).status).toBe(200);
    const transmis = await verificationPost(postReq({ note: "Conforme au plan, finitions propres." }), at());
    expect(transmis.status).toBe(200);

    expect(await prisma.jalon.findUniqueOrThrow({ where: { id: jalonId } })).toMatchObject({
      verifiedById: managerId,
      verificationNote: "Conforme au plan, finitions propres.",
    });
    // Aucune instruction de libération : vérifier n'est pas payer.
    expect(await prisma.pspEscrowOperation.count({ where: { contractId, instructionType: "release" } })).toBe(0);
  });

  it("le responsable ne prononce jamais la validation définitive", async () => {
    authAs(managerId);
    const res = await validatePost(postReq(), at());
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("verification_only");
  });

  it("un rejet efface la vérification ; le nouveau livrable doit être revérifié", async () => {
    authAs(clientId);
    expect((await rejectPost(postReq({ rejectionReason: "Joints à reprendre côté nord" }), at())).status).toBe(200);
    expect((await prisma.jalon.findUniqueOrThrow({ where: { id: jalonId } })).verifiedAt).toBeNull();

    preuveId = await soumettreLivrable();
    authAs(clientId);
    expect((await (await validatePost(postReq(), at())).json()).error).toBe("verification_required");

    authAs(managerId);
    expect((await appreciatePost(postReq({ action: "validee" }), atProof(preuveId))).status).toBe(200);
    expect((await verificationPost(postReq(), at())).status).toBe(200);
  });

  it("le client valide définitivement : c'est là, et seulement là, que les fonds partent", async () => {
    authAs(clientId);
    expect((await validatePost(postReq(), at())).status).toBe(200);
    const release = await prisma.pspEscrowOperation.findFirstOrThrow({ where: { contractId, instructionType: "release" } });
    expect(release.amount).toBe(MONTANT);
    // Trois gestes, trois traces : vérification (responsable), validation (client), PSP.
    expect(await prisma.jalon.findUniqueOrThrow({ where: { id: jalonId } })).toMatchObject({
      verifiedById: managerId,
      clientValidatedById: clientId,
    });
    expect((await prisma.jalon.findUniqueOrThrow({ where: { id: jalonId } })).clientValidatedAt).not.toBeNull();
  });
});

describe("OPR — catégorie, désignation avant financement, remplacement tracé", () => {
  const brouillon = (categorieId: string) =>
    postReq({
      titre: `Brouillon OPR ${RUN}`,
      description: "Mission de test pour la règle de catégorie OPR.",
      domaine: "batiment",
      categorieId,
      delaiJours: 10,
      validationMode: "opr",
      status: "brouillon",
    });

  it("le mode OPR est refusé pour une catégorie qui ne l'autorise pas", async () => {
    authAs(clientId);
    const res = await missionPost(brouillon(categorieSansOprId));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("opr_not_allowed_for_category");
  });

  it("…et accepté pour une catégorie qui l'autorise", async () => {
    authAs(clientId);
    const res = await missionPost(brouillon(categorieOprId));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    brouillons.push(id);
    expect((await prisma.mission.findUniqueOrThrow({ where: { id } })).validationMode).toBe("opr");
  });

  const atMission = () => ({ params: Promise.resolve({ id: missionId }) });
  const patchReq = (identifier: string | null) =>
    new Request("http://localhost/api", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ identifier }) });

  it("retirer le responsable est inscrit au contrat, notifié, et bloque le financement d'un jalon", async () => {
    authAs(clientId);
    expect((await siteManagerPatch(patchReq(null), atMission())).status).toBe(200);
    expect(await prisma.contractAuditEntry.findFirst({ where: { contractId, event: "site_manager_revoked" } })).not.toBeNull();
    expect(await prisma.missionNotification.count({ where: { missionId, userId: providerId, type: "responsable_chantier" } })).toBe(1);

    const hold = await jalonHoldPost(postReq(), { params: Promise.resolve({ id: missionId, jalonId: jalon2Id }) });
    expect(hold.status).toBe(409);
    expect((await hold.json()).error).toBe("site_manager_required");
  });

  it("désigner puis remplacer : chaque changement est tracé et notifié aux intéressés", async () => {
    authAs(clientId);
    expect((await siteManagerPatch(patchReq(`e2e-opr-intrus-${RUN}@flexwork.test`), atMission())).status).toBe(200);
    expect((await siteManagerPatch(patchReq(`e2e-opr-rc-${RUN}@flexwork.test`), atMission())).status).toBe(200);

    const evenements = (await prisma.contractAuditEntry.findMany({ where: { contractId }, orderBy: { createdAt: "asc" } })).map((e) => e.event);
    expect(evenements).toEqual(["site_manager_revoked", "site_manager_designated", "site_manager_replaced"]);
    // Le prestataire est informé de chaque changement ; l'ancien responsable de sa sortie.
    expect(await prisma.missionNotification.count({ where: { missionId, userId: providerId, type: "responsable_chantier" } })).toBe(3);
    expect(await prisma.missionNotification.count({ where: { missionId, userId: intrusId, type: "responsable_chantier" } })).toBe(2);

    // Redésigner la même personne ne crée ni entrée ni notification.
    expect((await siteManagerPatch(patchReq(`e2e-opr-rc-${RUN}@flexwork.test`), atMission())).status).toBe(200);
    expect(await prisma.contractAuditEntry.count({ where: { contractId } })).toBe(3);

    // Le responsable redésigné, le financement du jalon suivant redevient possible.
    const hold = await jalonHoldPost(postReq(), { params: Promise.resolve({ id: missionId, jalonId: jalon2Id }) });
    expect(hold.status).toBe(200);
  });
});
