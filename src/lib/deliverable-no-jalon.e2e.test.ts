/**
 * Test E2E du triptyque "Gestion des livrables" pour un contrat SANS jalon (2026-09-02) —
 * accumulation de preuves catégorisées → liste → soumission explicite, au niveau de la
 * MISSION ENTIÈRE (POST/GET /api/missions/[id]/deliverable, POST .../deliverable/submit).
 *
 * Avant ce correctif, un contrat sans jalon retombait sur un simple champ "un seul fichier"
 * qui soumettait directement — ce triptyque n'existait QUE pour le cas fractionné (jalons,
 * voir mission-lifecycle.e2e.test.ts). Les deux modes se présentent et se comportent
 * désormais de façon identique (maquette VJR, "Gestion des livrables — Mode Freelance").
 *
 * Même pattern que mission-lifecycle.e2e.test.ts : vrais route handlers Next.js, auth
 * mockée, état vérifié en base.
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
import { POST as deliverablePost, GET as deliverableGet } from "@/app/api/missions/[id]/deliverable/route";
import { POST as deliverableSubmitPost } from "@/app/api/missions/[id]/deliverable/submit/route";
import { POST as appreciatePost } from "@/app/api/missions/[id]/deliverable/[attachmentId]/appreciate/route";
import { POST as escrowRejectPost } from "@/app/api/missions/[id]/escrow/reject/route";
import { POST as escrowReleasePost } from "@/app/api/missions/[id]/escrow/release/route";
import { POST as declareProgressPost } from "@/app/api/missions/[id]/declare-progress/route";
import { POST as observeProgressPost } from "@/app/api/missions/[id]/observe-progress/route";
import { GET as filesGet } from "@/app/api/files/[token]/route";
import { signPrivateFileToken } from "@/lib/storage";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-nojalon-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-nojalon-provider-${RUN}@flexwork.test`;
const PASSPHRASE = "passphrase-e2e-nojalon-2026";
const BUDGET = 80000;

let clientId: string;
let providerId: string;
let missionId: string;
let proposalId: string;
let contractId: string;

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur", role: "client" } });
}
function postReq(body: unknown): Request {
  return new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
function proofForm(category: string, opts: { file?: boolean; note?: string } = {}): Request {
  const fd = new FormData();
  fd.append("category", category);
  if (opts.file) fd.append("file", new File([new Blob(["contenu de test"])], "preuve.jpg", { type: "image/jpeg" }));
  if (opts.note) fd.append("note", opts.note);
  return new Request("http://localhost/api", { method: "POST", body: fd });
}

async function cleanup() {
  await prisma.contractAuditEntry.deleteMany({ where: { contract: { missionId } } });
  await prisma.contractSignature.deleteMany({ where: { contract: { missionId } } });
  await prisma.pspEscrowOperation.deleteMany({ where: { contract: { missionId } } });
  await prisma.missionAttachment.deleteMany({ where: { missionId } });
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
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}4`, role: "client", status: "active", country: "BJ", firstname: "E2E", lastname: "ClientNJ", kycStatus: "verifie" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}5`, role: "expert_digital", status: "active", country: "BJ", firstname: "E2E", lastname: "PrestataireNJ", kycStatus: "verifie" },
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

describe("Triptyque livrable — contrat SANS jalon (mission entière)", () => {
  it("N1 — mission publiée, candidature acceptée, contrat SANS jalon signé, fonds sous séquestre", async () => {
    authAs(clientId);
    const m = await missionPost(postReq({
      titre: "Refonte identité visuelle", description: "Logo, charte graphique et déclinaisons print/web.",
      domaine: "design", mode: "distance", budgetType: "FIXED", budget: BUDGET, currency: "XOF", delaiJours: 10,
      professionalType: "EXPERT_DIGITAL", level: "Senior", status: "publiee",
    }));
    expect(m.status).toBe(200);
    missionId = (await m.json()).id;

    authAs(providerId);
    const p = await proposalPost(postReq({ montant: BUDGET, message: "Je peux livrer sous 10 jours." }), { params: Promise.resolve({ id: missionId }) });
    expect(p.status).toBe(200);
    proposalId = (await p.json()).id;

    authAs(clientId);
    expect((await acceptPost(postReq({}), { params: Promise.resolve({ id: missionId, proposalId }) })).status).toBe(200);

    // Contrat SANS jalon : pas de champ `jalons` dans le body — comportement historique.
    const c = await contractPost(postReq({}), { params: Promise.resolve({ id: missionId }) });
    expect(c.status).toBe(200);
    contractId = (await c.json()).id;
    const contract = await prisma.prestationContract.findUniqueOrThrow({ where: { id: contractId }, include: { jalons: true } });
    expect(contract.jalons.length).toBe(0);

    authAs(providerId);
    const certP = await certPost(postReq({ commonName: "E2E Prestataire NJ", email: PROVIDER_EMAIL, passphrase: PASSPHRASE }));
    const providerCertId = (await certP.json()).data.id;
    authAs(clientId);
    const certC = await certPost(postReq({ commonName: "E2E Client NJ", email: CLIENT_EMAIL, passphrase: PASSPHRASE }));
    const clientCertId = (await certC.json()).data.id;

    authAs(providerId);
    expect((await signPost(postReq({ contractId, certificateId: providerCertId, passphrase: PASSPHRASE }))).status).toBe(200);
    authAs(clientId);
    const s2 = await signPost(postReq({ contractId, certificateId: clientCertId, passphrase: PASSPHRASE }));
    expect(s2.status).toBe(200);

    // Contrat sans jalon : la contre-signature déclenche le HOLD global automatiquement
    // (src/lib/escrow.ts::requestContractHold) — confirmé ici via la PSP virtuelle.
    const holdOp = await prisma.pspEscrowOperation.findFirstOrThrow({ where: { contractId, instructionType: "hold" } });
    expect((await operateVirtualPsp("authorize", holdOp.pspReference!)).ok).toBe(true);

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("fonds_sous_sequestre");
  });

  it("N2 — soumettre AVANT toute preuve est refusé (no_proof_attached)", async () => {
    authAs(providerId);
    const res = await deliverableSubmitPost(postReq({}), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("no_proof_attached");

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("fonds_sous_sequestre"); // inchangé
  });

  it("N3 — le prestataire accumule 2 preuves de catégories différentes (photo + note libre)", async () => {
    authAs(providerId);
    const r1 = await deliverablePost(proofForm("photo", { file: true }), { params: Promise.resolve({ id: missionId }) });
    expect(r1.status).toBe(200);
    expect((await r1.json()).category).toBe("photo");

    const r2 = await deliverablePost(proofForm("other", { note: "Fiche technique validée avec le client" }), { params: Promise.resolve({ id: missionId }) });
    expect(r2.status).toBe(200);
    expect((await r2.json()).category).toBe("other");

    const inBase = await prisma.missionAttachment.findMany({ where: { missionId, jalonId: null } });
    expect(inBase.length).toBe(2);

    // L'upload seul n'a PAS basculé le statut (contrairement à l'ancien comportement) :
    // c'est bien POST .../deliverable/submit qui doit être appelé explicitement.
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("fonds_sous_sequestre");
  });

  it("N4 — GET .../deliverable liste les 2 preuves accumulées", async () => {
    authAs(clientId); // le client peut aussi lire (accès partagé, même règle que par jalon)
    const res = await deliverableGet(new Request("http://localhost/api"), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(200);
    const items = (await res.json()).items as { category: string; note: string | null; url: string | null; mimeType: string | null }[];
    expect(items.length).toBe(2);
    expect(items.map((i) => i.category).sort()).toEqual(["other", "photo"]);
    const photo = items.find((i) => i.category === "photo")!;
    expect(photo.url).not.toBeNull(); // fichier réel → lien signé
    // mimeType capturé à l'upload (2026-09-03) — sans lui, /api/files/[token] ne peut pas
    // servir le bon Content-Type et le client ne peut pas RELIRE la preuve (image affichée,
    // vidéo lisible), seulement la télécharger à l'aveugle.
    expect(photo.mimeType).toBe("image/jpeg");
    const other = items.find((i) => i.category === "other")!;
    expect(other.url).toBeNull(); // preuve texte-seule → pas de lien de téléchargement
    expect(other.mimeType).toBeNull(); // pas de fichier réel → pas de mimeType

    // GET /api/files/[token] : Content-Type réel + affichage inline pour une image — sans
    // ça, le navigateur refuserait d'afficher <img src="..."> (Content-Type générique
    // forçant le téléchargement). Vérifié via un VRAI appel à la route, pas supposé.
    const rawAttachment = await prisma.missionAttachment.findFirstOrThrow({ where: { missionId, category: "photo" } });
    const token = signPrivateFileToken("mission_attachment", rawAttachment.id);
    authAs(clientId);
    const fileRes = await filesGet(new Request("http://localhost/api"), { params: Promise.resolve({ token }) });
    expect(fileRes.status).toBe(200);
    expect(fileRes.headers.get("Content-Type")).toBe("image/jpeg");
    expect(fileRes.headers.get("Content-Disposition")).toContain("inline");
  });

  it("N5 — soumission pour validation → mission livrable_soumis", async () => {
    authAs(providerId);
    const res = await deliverableSubmitPost(postReq({}), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("livrable_soumis");

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("livrable_soumis");
  });

  it("N6 — après soumission, une nouvelle preuve peut encore s'accumuler (re-soumission après rejet)", async () => {
    authAs(providerId);
    const res = await deliverablePost(proofForm("document", { file: true }), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(200);

    const inBase = await prisma.missionAttachment.count({ where: { missionId, jalonId: null } });
    expect(inBase).toBe(3);
  });

  it("N7 — rejet sans motif refusé (rejection_reason_required)", async () => {
    authAs(clientId);
    const res = await escrowRejectPost(postReq({}), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("rejection_reason_required");
  });

  it("N8 — le prestataire ne peut pas rejeter (forbidden — action réservée au client)", async () => {
    authAs(providerId);
    const res = await escrowRejectPost(postReq({ rejectionReason: "test" }), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(404); // not_found : la garde ne matche que { missionId, clientId: userId }
  });

  it("N9 — rejet motivé par le client → mission repasse fonds_sous_sequestre, motif notifié au prestataire", async () => {
    authAs(clientId);
    const res = await escrowRejectPost(postReq({ rejectionReason: "Logo non conforme à la charte fournie, merci de reprendre les couleurs." }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("fonds_sous_sequestre");

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("fonds_sous_sequestre");

    // Depuis le 2026-09-09 un rejet notifie LES DEUX parties (src/lib/mission-notify.ts →
    // notifyMissionParties) : on cible donc explicitement le destinataire de chaque message
    // au lieu de prendre « la » notification du type, qui n'est plus unique.
    const notif = await prisma.missionNotification.findFirstOrThrow({
      where: { missionId, type: "deliverable_rejected", userId: providerId },
    });
    expect(notif.message).toContain("Logo non conforme");

    // Le client reçoit son propre accusé, avec le motif qu'il vient de transmettre.
    const notifClient = await prisma.missionNotification.findFirstOrThrow({
      where: { missionId, type: "deliverable_rejected", userId: clientId },
    });
    expect(notifClient.message).toContain("Logo non conforme");

    // GET .../deliverable expose ce motif au prestataire (deliverable/page.tsx).
    authAs(providerId);
    const g = await deliverableGet(new Request("http://localhost/api"), { params: Promise.resolve({ id: missionId }) });
    expect((await g.json()).lastRejectionReason).toContain("Logo non conforme");
  });

  it("N10 — après rejet, canSubmitDeliverable redevient vrai : le prestataire resoumet puis le client valide", async () => {
    authAs(providerId);
    expect((await deliverablePost(proofForm("photo", { file: true }), { params: Promise.resolve({ id: missionId }) })).status).toBe(200);
    expect((await deliverableSubmitPost(postReq({}), { params: Promise.resolve({ id: missionId }) })).status).toBe(200);

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("livrable_soumis");

    // Un rejet ultérieur ne doit plus remonter comme motif actuel une fois qu'une nouvelle
    // preuve a été ajoutée après lui (lastRejectionIsStale, voir GET .../deliverable).
    authAs(providerId);
    const g = await deliverableGet(new Request("http://localhost/api"), { params: Promise.resolve({ id: missionId }) });
    expect((await g.json()).lastRejectionReason).toBeNull();
  });

  it("N11 — release refusé tant que la progression constatée n'atteint pas 100% (progress_incomplete)", async () => {
    authAs(clientId);
    const res = await escrowReleasePost(postReq({}), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("progress_incomplete");

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("livrable_soumis"); // inchangé
    expect(mission.observedProgress).toBe(0); // valeur par défaut, jamais déclarée sur cette mission
  });

  it("N12 — le prestataire déclare sa progression (purement déclaratif, ne gate rien)", async () => {
    authAs(providerId);
    const res = await declareProgressPost(postReq({ progress: 60 }), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(200);
    expect((await res.json()).declaredProgress).toBe(60);

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.declaredProgress).toBe(60);
    expect(mission.observedProgress).toBe(0); // la déclaration du prestataire ne gate jamais rien
  });

  it("N13 — le client constate 60% : le release reste refusé (< 100)", async () => {
    authAs(clientId);
    const o = await observeProgressPost(postReq({ progress: 60 }), { params: Promise.resolve({ id: missionId }) });
    expect(o.status).toBe(200);
    expect((await o.json()).observedProgress).toBe(60);

    const res = await escrowReleasePost(postReq({}), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("progress_incomplete");
  });

  it("N14 — rejet à 60% constaté : la déclaration repart à 0, la progression constatée VALIDÉE est conservée", async () => {
    authAs(clientId);
    const res = await escrowRejectPost(postReq({ rejectionReason: "Reprises nécessaires avant validation" }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("fonds_sous_sequestre");
    expect(mission.declaredProgress).toBe(0);
    // Bug corrigé 2026-09-05 (spec "financement par jalons à validation progressive") : un
    // rejet ne défait jamais une progression déjà constatée par le client — il renvoie
    // seulement CETTE soumission en révision. Avant ce correctif, observedProgress repartait
    // aussi à 0 ici, effaçant les 60% déjà constatés.
    expect(mission.observedProgress).toBe(60);
  });

  it("N14b — plancher du curseur : le prestataire ne peut pas redéclarer sous les 60% déjà validés (progress_below_floor)", async () => {
    authAs(providerId);
    const res = await declareProgressPost(postReq({ progress: 30 }), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("progress_below_floor");

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.declaredProgress).toBe(0); // inchangé — la tentative sous le plancher n'écrit rien

    // Déclarer exactement le plancher (60%) ou au-dessus reste autorisé.
    const ok = await declareProgressPost(postReq({ progress: 60 }), { params: Promise.resolve({ id: missionId }) });
    expect(ok.status).toBe(200);
  });

  it("N14c — rejet d'UNE preuve = rejet AUTOMATIQUE de la soumission (spec §10/14) : la mission repart en fonds_sous_sequestre + ProgressRejection tracé", async () => {
    authAs(providerId);
    expect((await deliverablePost(proofForm("photo", { file: true }), { params: Promise.resolve({ id: missionId }) })).status).toBe(200);
    expect((await deliverableSubmitPost(postReq({}), { params: Promise.resolve({ id: missionId }) })).status).toBe(200);

    authAs(clientId);
    // La preuve rejetée = la plus récente du lot courant (appreciation null).
    const proof = await prisma.missionAttachment.findFirstOrThrow({
      where: { missionId, jalonId: null, appreciation: null },
      orderBy: { createdAt: "desc" },
    });

    // Rejet PAR PREUVE (sans clic « Rejeter » de lot) : le statut doit basculer tout seul.
    const res = await appreciatePost(
      postReq({ action: "rejetee", reason: "Qualité insuffisante", motif: "Preuve floue et incomplète, à reprendre entièrement", requestNewProof: true }),
      { params: Promise.resolve({ id: missionId, attachmentId: proof.id }) }
    );
    expect(res.status).toBe(200);

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    // SUBMITTED → REJECTED automatique : la mission repart en fonds_sous_sequestre, prête à
    // une resoumission — sans attendre le rejet de lot explicite.
    expect(mission.status).toBe("fonds_sous_sequestre");
    expect(mission.declaredProgress).toBe(0); // nouveau cycle
    expect(mission.observedProgress).toBe(60); // conservé — un rejet ne défait pas les 60% constatés

    // Trace append-only : le lot rejeté doit apparaître comme sa propre version ("…-rej").
    const rejection = await prisma.progressRejection.findFirstOrThrow({
      where: { missionId, jalonId: null },
      orderBy: { createdAt: "desc" },
    });
    expect(rejection.reason).toBe("Qualité insuffisante");
    expect(rejection.rejectedById).toBe(clientId);

    const updatedProof = await prisma.missionAttachment.findUniqueOrThrow({ where: { id: proof.id } });
    expect(updatedProof.appreciation).toBe("rejetee");
    expect(updatedProof.requestNewProof).toBe(true);
  });

  it("N15 — resoumission puis constat à 100% : le release aboutit, la mission clôture", async () => {
    authAs(providerId);
    expect((await deliverablePost(proofForm("document", { file: true }), { params: Promise.resolve({ id: missionId }) })).status).toBe(200);
    expect((await deliverableSubmitPost(postReq({}), { params: Promise.resolve({ id: missionId }) })).status).toBe(200);

    authAs(clientId);
    // Pré-validation par preuve (2026-09-05) : chaque preuve du lot courant doit être
    // appréciée par le client avant la libération — le client valide la preuve resoumise.
    await prisma.missionAttachment.updateMany({
      where: { missionId, jalonId: null, appreciation: null },
      data: { appreciation: "validee", appreciatedById: clientId, appreciatedAt: new Date() },
    });
    expect((await observeProgressPost(postReq({ progress: 100 }), { params: Promise.resolve({ id: missionId }) })).status).toBe(200);

    const res = await escrowReleasePost(postReq({}), { params: Promise.resolve({ id: missionId }) });
    expect(res.status).toBe(200);
    const { id: opId } = await res.json();

    // Mode console (pas autoconfirm dans ce fichier) : l'instruction RELEASE est `pending`
    // tant que le webhook signé ne l'a pas confirmée — même pattern que le HOLD initial (N1).
    const op = await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: opId } });
    expect((await operateVirtualPsp("release", op.pspReference!)).ok).toBe(true);

    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("cloturee"); // RELEASE confirmé → cloturee directement (psp-webhook.ts)
  });
});
