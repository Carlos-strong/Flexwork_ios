/**
 * Gardes de la retenue de garantie (mode J4) — les correctifs du 2026-09-11.
 *
 * Le fichier frère retention-release.e2e.test.ts couvre le parcours NOMINAL (tous les jalons
 * validés, retenue libérée, invariant comptable). Celui-ci couvre ce qui l'entoure, c'est-à-dire
 * les cas où la première implémentation se trompait :
 *
 *   G1 — une retenue sur un jalon UNIQUE ne garantit rien : le contrat est refusé.
 *   G2 — scinder un jalon changerait la retenue déjà écrite au contrat signé : refusé.
 *   G3 — une libération de MÉDIATION partage le scope « contrat sans jalon » : elle ne doit ni
 *        empêcher l'émission de la retenue, ni clôturer la mission à sa place.
 *   G4 — deux arrivées concurrentes n'émettent qu'UNE retenue.
 *   G5 — une mission arrêtée en cours de route peut solder la retenue déjà prélevée, au lieu de
 *        la laisser immobilisée au séquestre pour toujours.
 *
 * Mode CONSOLE (pas d'autoconfirm), comme les autres e2e monétaires : c'est la temporalité de
 * la production, et c'est la seule qui rend les états intermédiaires observables.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as contractPost } from "@/app/api/missions/[id]/contract/route";
import { POST as splitPost } from "@/app/api/missions/[id]/jalons/[jalonId]/split/route";
import { POST as settlePost } from "@/app/api/admin/contracts/[contractId]/retention/settle/route";
import { closeJalonFullyReleased } from "@/lib/psp-webhook";
import { emitScopedRelease } from "@/lib/escrow";
import { progressiveReleaseTarget } from "@/lib/jalons";
import { operateVirtualPsp } from "@/lib/psp-virtual";
import { applyPspWebhookEvent, type PspWebhookPayload } from "@/lib/psp-webhook";
import { signWebhookPayload } from "@/lib/webhook-signing";
import { POST as mediationOpenPost } from "@/app/api/missions/[id]/mediation/route";
import { POST as proposePost } from "@/app/api/admin/mediations/[id]/propose/route";
import { POST as respondPost } from "@/app/api/admin/mediations/[id]/respond/route";
import { RETENTION_RATE_J4 } from "@/lib/financing-modes";
import { prisma } from "@/lib/db";
import { randomUUID } from "crypto";

const RUN = Date.now();
const CLIENT_EMAIL = `e2e-retgard-client-${RUN}@flexwork.test`;
const PROVIDER_EMAIL = `e2e-retgard-provider-${RUN}@flexwork.test`;
const ADMIN_EMAIL = `e2e-retgard-admin-${RUN}@flexwork.test`;

let clientId: string;
let providerId: string;
let adminId: string;
const missionIds: string[] = [];

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

/**
 * Mission + proposition acceptée, sans contrat. `modeKey` conditionne ce que la génération du
 * contrat appliquera.
 */
async function createMission(modeKey: string, prix: number): Promise<string> {
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: `E2E gardes retenue ${modeKey} ${randomUUID().slice(0, 8)}`,
      description: "Mission de test des gardes de la retenue de garantie.",
      domaine: "developpement",
      budget: prix,
      currency: "XOF",
      delaiJours: 30,
      status: "proposition_acceptee",
      financingModeKey: modeKey,
    },
  });
  missionIds.push(mission.id);
  await prisma.missionProposal.create({
    data: { missionId: mission.id, providerId, montant: prix, status: "acceptee" },
  });
  return mission.id;
}

/**
 * Contrat + jalons créés DIRECTEMENT en base : pour G2 à G5 l'unité testée est la scission, le
 * webhook ou le solde admin — pas la génération de contrat, déjà couverte par G1 et par
 * retention-release.e2e.test.ts. Créer l'état voulu sans le jouer évite de faire dépendre ces
 * gardes de tout le parcours signature/séquestre.
 */
async function createSignedContract(
  missionId: string,
  retentionRate: number,
  montants: number[],
  // Les jalons sont-ils financés ? `true` (défaut) fabrique l'état d'une mission en cours :
  // HOLD confirmé par jalon, indispensable pour que la retenue ait un solde à instruire
  // (heldBalance). `false` laisse les jalons NON financés — le seul état où une scission est
  // légitime, et le seul cohérent avec un statut `en_attente` (un HOLD confirmé ferait basculer
  // le jalon en `fonds_sous_sequestre`).
  { withHolds = true }: { withHolds?: boolean } = {}
): Promise<{ contractId: string; jalonIds: string[] }> {
  const contract = await prisma.prestationContract.create({
    data: {
      missionId,
      clientId,
      providerId,
      termsSnapshot: { prix: montants.reduce((s, m) => s + m, 0) },
      currentHash: `hash_${randomUUID()}`,
      clientSignedAt: new Date(),
      providerSignedAt: new Date(),
      retentionRate,
    },
  });
  const jalonIds: string[] = [];
  for (let i = 0; i < montants.length; i++) {
    const j = await prisma.jalon.create({
      data: { contractId: contract.id, ordre: i + 1, titre: `Jalon ${i + 1}`, montant: montants[i] },
    });
    jalonIds.push(j.id);
    if (!withHolds) continue;
    // HOLD confirmé par jalon : indispensable, et pas seulement pour le réalisme. L'émission de
    // la retenue est bornée par le solde réellement séquestré d'après le registre
    // (heldBalance, src/lib/escrow.ts) — un contrat fabriqué sans aucune entrée de fonds a un
    // solde nul et n'instruirait donc rien, à juste titre.
    await prisma.pspEscrowOperation.create({
      data: {
        contractId: contract.id,
        jalonId: j.id,
        pspName: "psp-virtuelle",
        pspReference: `hold_${randomUUID()}`,
        amount: montants[i],
        currency: "XOF",
        instructionType: "hold",
        status: "confirmed",
        pspConfirmedAt: new Date(),
      },
    });
  }
  return { contractId: contract.id, jalonIds };
}

// Rejoue un évènement webhook SIGNÉ — strictement le chemin qu'emprunterait un vrai PSP
// (POST /api/webhooks/psp passe par la même fonction après vérification de signature).
async function replayWebhook(pspReference: string, event: PspWebhookPayload["event"]) {
  const payload: PspWebhookPayload = { pspReference, event };
  return applyPspWebhookEvent(payload, signWebhookPayload(payload as unknown as Record<string, unknown>));
}

async function retentionOps(contractId: string) {
  return prisma.pspEscrowOperation.findMany({
    where: { contractId, instructionType: "retention_release" },
  });
}

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  delete process.env.ESCROW_STUB_AUTOCONFIRM;

  const client = await prisma.user.create({
    data: { email: CLIENT_EMAIL, tel: `+229${RUN}1`, role: "client", status: "active", country: "BJ", firstname: "E2E", lastname: "Client", kycStatus: "verifie" },
  });
  const provider = await prisma.user.create({
    data: { email: PROVIDER_EMAIL, tel: `+229${RUN}2`, role: "expert_digital", status: "active", country: "BJ", firstname: "E2E", lastname: "Prestataire", kycStatus: "verifie" },
  });
  const admin = await prisma.user.create({
    data: { email: ADMIN_EMAIL, tel: `+229${RUN}3`, role: "client", status: "active", country: "BJ", firstname: "E2E", lastname: "Admin", kycStatus: "verifie", isAdmin: true, adminRole: "mediation" },
  });
  clientId = client.id;
  providerId = provider.id;
  adminId = admin.id;

  await prisma.featureFlag.upsert({
    where: { key_zone: { key: "psp_montage_valide", zone: "BJ" } },
    update: { enabled: true },
    create: { key: "psp_montage_valide", zone: "BJ", enabled: true },
  });
});

afterAll(async () => {
  await prisma.pspEscrowOperation.deleteMany({ where: { contract: { missionId: { in: missionIds } } } });
  await prisma.jalon.deleteMany({ where: { contract: { missionId: { in: missionIds } } } });
  await prisma.prestationContract.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.missionProposal.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, providerId, adminId] } } });
});

describe("G1 — une retenue sur un jalon unique est refusée à la génération du contrat", () => {
  it("refuse J4 quand le découpage ne produit qu'un seul jalon", async () => {
    const missionId = await createMission("J4", 200000);
    authAs(clientId);
    const res = await contractPost(postReq({ jalons: [{ titre: "Prestation globale", montant: 200000 }] }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("retention_requires_multiple_jalons");
    // Et aucun contrat n'a été créé au passage.
    expect(await prisma.prestationContract.count({ where: { missionId } })).toBe(0);
  });

  it("accepte le même découpage unique sur un mode SANS retenue (J1) — la garde est bien ciblée", async () => {
    const missionId = await createMission("J1", 200000);
    authAs(clientId);
    const res = await contractPost(postReq({ jalons: [{ titre: "Prestation globale", montant: 200000 }] }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);
    const contract = await prisma.prestationContract.findUniqueOrThrow({ where: { missionId } });
    expect(contract.retentionRate).toBe(0);
  });

  it("accepte J4 dès deux jalons", async () => {
    const missionId = await createMission("J4", 200000);
    authAs(clientId);
    const res = await contractPost(
      postReq({ jalons: [{ titre: "Gros œuvre", montant: 120000 }, { titre: "Finitions", montant: 80000 }] }),
      { params: Promise.resolve({ id: missionId }) }
    );
    expect(res.status).toBe(200);
    const contract = await prisma.prestationContract.findUniqueOrThrow({ where: { missionId } });
    expect(contract.retentionRate).toBe(RETENTION_RATE_J4);
  });
});

describe("G2 — la scission est refusée tant qu'une retenue est figée au contrat", () => {
  it("refuse de scinder un jalon d'un contrat à retenue", async () => {
    const missionId = await createMission("J4", 200000);
    const { jalonIds } = await createSignedContract(missionId, RETENTION_RATE_J4, [120000, 80000], { withHolds: false });
    authAs(clientId);
    const res = await splitPost(
      postReq({ parts: [{ titre: "A", montant: 60000 }, { titre: "B", montant: 60000 }] }),
      { params: Promise.resolve({ id: missionId, jalonId: jalonIds[0] }) }
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("split_forbidden_with_retention");
  });

  it("laisse scinder un contrat SANS retenue — la garde ne déborde pas", async () => {
    const missionId = await createMission("J1", 200000);
    const { jalonIds } = await createSignedContract(missionId, 0, [120000, 80000], { withHolds: false });
    authAs(clientId);
    const res = await splitPost(
      postReq({ parts: [{ titre: "A", montant: 60000 }, { titre: "B", montant: 60000 }] }),
      { params: Promise.resolve({ id: missionId, jalonId: jalonIds[0] }) }
    );
    expect(res.status).toBe(200);
  });
});

describe("G2bis — un jalon dont le paiement est parti n'est plus scindable", () => {
  it("refuse la scission tant qu'un HOLD est en vol ou abouti", async () => {
    // Le statut ne suffisait pas : un HOLD `pending` laisse le jalon `en_attente`, et la
    // scission le SUPPRIME — l'opération PSP partait en cascade, le webhook arrivait sur une
    // référence disparue, et le débit du client n'avait plus de trace.
    const missionId = await createMission("J1", 200000);
    const { jalonIds } = await createSignedContract(missionId, 0, [120000, 80000]);
    await prisma.pspEscrowOperation.updateMany({
      where: { jalonId: jalonIds[0] },
      data: { status: "pending", pspConfirmedAt: null },
    });

    authAs(clientId);
    const res = await splitPost(
      postReq({ parts: [{ titre: "A", montant: 60000 }, { titre: "B", montant: 60000 }] }),
      { params: Promise.resolve({ id: missionId, jalonId: jalonIds[0] }) }
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("jalon_payment_in_flight");
    // Le jalon et son opération sont intacts.
    expect(await prisma.jalon.count({ where: { id: jalonIds[0] } })).toBe(1);
    expect(await prisma.pspEscrowOperation.count({ where: { jalonId: jalonIds[0] } })).toBe(1);
  });
});

describe("G3 — une libération de médiation ne se confond plus avec la retenue", () => {
  it("n'empêche pas l'émission de la retenue et ne clôture pas la mission", async () => {
    const missionId = await createMission("J4", 200000);
    const { contractId, jalonIds } = await createSignedContract(missionId, RETENTION_RATE_J4, [120000, 80000]);

    // Libération de médiation : même scope « contrat sans jalon » que la retenue d'avant le
    // correctif, et d'un montant sans rapport (le budget entier).
    const mediation = await prisma.pspEscrowOperation.create({
      data: {
        contractId,
        pspName: "psp-virtuelle",
        pspReference: `mediation_release_${randomUUID()}`,
        // Montant volontairement modeste : ce cas teste le DISCRIMINANT de type, pas la borne de
        // solde. Une médiation qui viderait le séquestre ferait échouer l'émission pour une
        // toute autre raison (heldBalance), et le test ne prouverait plus ce qu'il annonce.
        amount: 1000,
        currency: "XOF",
        instructionType: "release",
      },
    });
    expect((await operateVirtualPsp("release", mediation.pspReference!)).ok).toBe(true);

    // Elle ne clôture pas la mission : son montant n'a aucun rapport avec un seuil de fin.
    const apresMediation = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(apresMediation.status).not.toBe("cloturee");

    // Et la retenue est bien émise malgré sa présence — c'était le blocage : la garde
    // d'idempotence prenait ce release de médiation pour la retenue déjà partie.
    await prisma.jalon.update({ where: { id: jalonIds[0] }, data: { status: "libere" } });
    await closeJalonFullyReleased(jalonIds[1], contractId, missionId);

    const ops = await retentionOps(contractId);
    expect(ops).toHaveLength(1);
    expect(ops[0].amount).toBe(6000 + 4000);
  });
});

// ⚠️ PORTÉE DE G4, à lire avant de s'y fier : ces deux cas vérifient la GARDE d'idempotence
// (une instruction en vol interdit d'en créer une seconde), qui est déterministe et donc
// réellement testable ici. Ils ne PROUVENT pas la sérialisation sous concurrence : reproduire de
// façon fiable l'entrelacement « deux transactions lisent la garde vide avant que l'une n'écrive »
// demanderait une barrière à l'intérieur de la transaction, c'est-à-dire instrumenter le code de
// production. Vérifié empiriquement : le cas parallèle ci-dessous passe AUSSI sans le
// `SELECT … FOR UPDATE`, il ne discrimine donc pas le correctif. C'est le verrou lui-même, dans
// emitRetentionRelease, qui porte cette garantie — pas ce test.
describe("G4 — la garde d'idempotence n'émet jamais deux retenues", () => {
  it("deux clôtures successives n'instruisent la retenue qu'une fois", async () => {
    const missionId = await createMission("J4", 200000);
    const { contractId, jalonIds } = await createSignedContract(missionId, RETENTION_RATE_J4, [120000, 80000]);
    await prisma.jalon.updateMany({ where: { id: { in: jalonIds } }, data: { status: "libere" } });

    await closeJalonFullyReleased(jalonIds[0], contractId, missionId);
    await closeJalonFullyReleased(jalonIds[1], contractId, missionId);

    const ops = await retentionOps(contractId);
    expect(ops).toHaveLength(1);
    expect(ops[0].amount).toBe(10000);
  });

  it("deux clôtures lancées en parallèle n'en instruisent qu'une non plus", async () => {
    const missionId = await createMission("J4", 200000);
    const { contractId, jalonIds } = await createSignedContract(missionId, RETENTION_RATE_J4, [120000, 80000]);

    // Les deux appels doivent atteindre l'émission : on les place donc dans l'état « plus aucun
    // jalon non libéré », de sorte que chacun voie `remaining === 0` et tente d'instruire.
    await prisma.jalon.updateMany({
      where: { id: { in: jalonIds } },
      data: { status: "libere" },
    });
    await Promise.all([
      closeJalonFullyReleased(jalonIds[0], contractId, missionId),
      closeJalonFullyReleased(jalonIds[1], contractId, missionId),
    ]);

    const ops = await retentionOps(contractId);
    expect(ops).toHaveLength(1);
    expect(ops[0].amount).toBe(10000);
  });
});

describe("G5 — une mission arrêtée peut solder la retenue déjà prélevée", () => {
  it("instruit la retenue des seuls jalons libérés, puis refuse un second appel", async () => {
    const missionId = await createMission("J4", 200000);
    const { contractId, jalonIds } = await createSignedContract(missionId, RETENTION_RATE_J4, [120000, 80000]);

    // Un jalon payé, l'autre jamais validé : le chemin nominal n'émettra jamais rien.
    await prisma.jalon.update({ where: { id: jalonIds[0] }, data: { status: "libere" } });
    await prisma.mission.update({ where: { id: missionId }, data: { status: "mediation_ouverte" } });
    expect(await retentionOps(contractId)).toHaveLength(0);

    authAs(adminId);
    const res = await settlePost(postReq({ justification: "Mission arrêtée — solde de la retenue (e2e)" }), { params: Promise.resolve({ contractId }) });
    expect(res.status).toBe(200);
    const body = await res.json();
    // 5 % de 120 000 seulement — le jalon jamais validé n'a jamais rien retenu.
    expect(body.amount).toBe(6000);
    expect(body.jalonsLiberes).toBe(1);

    const ops = await retentionOps(contractId);
    expect(ops).toHaveLength(1);

    // Idempotent : une instruction déjà en vol interdit d'en transmettre une seconde.
    const encore = await settlePost(postReq({ justification: "Mission arrêtée — solde de la retenue (e2e)" }), { params: Promise.resolve({ contractId }) });
    expect(encore.status).toBe(409);
    expect((await encore.json()).error).toBe("retention_already_instructed");
  });

  it("la confirmation du solde ne clôture pas une mission en médiation", async () => {
    const missionId = await createMission("J4", 200000);
    const { contractId, jalonIds } = await createSignedContract(missionId, RETENTION_RATE_J4, [120000, 80000]);
    await prisma.jalon.update({ where: { id: jalonIds[0] }, data: { status: "libere" } });
    await prisma.mission.update({ where: { id: missionId }, data: { status: "mediation_ouverte" } });

    authAs(adminId);
    expect((await settlePost(postReq({ justification: "Mission arrêtée — solde de la retenue (e2e)" }), { params: Promise.resolve({ contractId }) })).status).toBe(200);
    const [op] = await retentionOps(contractId);
    expect((await operateVirtualPsp("release", op.pspReference!)).ok).toBe(true);

    // Solder le séquestre ne tranche pas le litige.
    const mission = await prisma.mission.findUniqueOrThrow({ where: { id: missionId } });
    expect(mission.status).toBe("mediation_ouverte");
  });

  it("refuse un contrat sans retenue, et un contrat où rien n'a encore été libéré", async () => {
    const sansRetenue = await createMission("J1", 200000);
    const a = await createSignedContract(sansRetenue, 0, [120000, 80000]);
    authAs(adminId);
    const res1 = await settlePost(postReq({ justification: "Mission arrêtée — solde de la retenue (e2e)" }), { params: Promise.resolve({ contractId: a.contractId }) });
    expect(res1.status).toBe(409);
    expect((await res1.json()).error).toBe("no_retention_on_contract");

    const rienLibere = await createMission("J4", 200000);
    const b = await createSignedContract(rienLibere, RETENTION_RATE_J4, [120000, 80000]);
    const res2 = await settlePost(postReq({ justification: "Mission arrêtée — solde de la retenue (e2e)" }), { params: Promise.resolve({ contractId: b.contractId }) });
    expect(res2.status).toBe(409);
    expect((await res2.json()).error).toBe("no_retention_accrued");
  });

  it("est réservée à l'admin médiation", async () => {
    const missionId = await createMission("J4", 200000);
    const { contractId, jalonIds } = await createSignedContract(missionId, RETENTION_RATE_J4, [120000, 80000]);
    await prisma.jalon.update({ where: { id: jalonIds[0] }, data: { status: "libere" } });

    authAs(clientId); // le client est juge et partie sur une garantie prise contre le prestataire
    const res = await settlePost(postReq({ justification: "Mission arrêtée — solde de la retenue (e2e)" }), { params: Promise.resolve({ contractId }) });
    expect(res.status).toBe(403);
    expect(await retentionOps(contractId)).toHaveLength(0);
  });
});

describe("G6 — la retenue n'est jamais instruite au-delà de ce que le registre dit séquestré", () => {
  it("plafonne au solde réellement disponible", async () => {
    const missionId = await createMission("J4", 200000);
    const { contractId, jalonIds } = await createSignedContract(missionId, RETENTION_RATE_J4, [120000, 80000]);

    // Situation anormale FABRIQUÉE : plus de fonds sont déjà sortis que ne le voudrait le
    // calcul par jalons (ici 195 000 sur 200 000 séquestrés). Peu importe la cause — un défaut
    // en amont, une médiation, une reprise ratée : la retenue calculée vaut 10 000, le solde
    // réel 5 000. C'est le cas où instruire le montant calculé serait un sur-paiement.
    await prisma.pspEscrowOperation.create({
      data: {
        contractId,
        pspName: "psp-virtuelle",
        pspReference: `release_${randomUUID()}`,
        amount: 195000,
        currency: "XOF",
        instructionType: "release",
        status: "confirmed",
        pspConfirmedAt: new Date(),
      },
    });

    await prisma.jalon.updateMany({ where: { id: { in: jalonIds } }, data: { status: "libere" } });
    await closeJalonFullyReleased(jalonIds[1], contractId, missionId);

    const ops = await retentionOps(contractId);
    expect(ops).toHaveLength(1);
    expect(ops[0].amount, "plafonné au solde, pas au montant calculé").toBe(5000);
  });

  it("n'instruit rien du tout si plus rien n'est séquestré", async () => {
    const missionId = await createMission("J4", 200000);
    const { contractId, jalonIds } = await createSignedContract(missionId, RETENTION_RATE_J4, [120000, 80000]);
    await prisma.pspEscrowOperation.create({
      data: {
        contractId,
        pspName: "psp-virtuelle",
        pspReference: `release_${randomUUID()}`,
        amount: 200000,
        currency: "XOF",
        instructionType: "release",
        status: "confirmed",
        pspConfirmedAt: new Date(),
      },
    });

    await prisma.jalon.updateMany({ where: { id: { in: jalonIds } }, data: { status: "libere" } });
    await closeJalonFullyReleased(jalonIds[1], contractId, missionId);

    expect(await retentionOps(contractId)).toHaveLength(0);
  });
});

describe("G7 — le versement progressif ne dépend que du taux atteint, jamais du chemin", () => {
  it("une cible déjà atteinte n'instruit rien, une cible plus haute n'instruit que la différence", async () => {
    // Défaut corrigé (F8) : l'incrément se calculait depuis `observedProgress`, que DEUX routes
    // font monter — le point d'étape (qui libère) et `observe-progress` (qui ne libère pas). Un
    // client montant à 100 % par observe-progress puis confirmant un point d'étape à 100 %
    // produisait un incrément NUL : le mode progressif se dégradait en paiement unique, sans
    // erreur ni trace. En raisonnant sur le CUMUL dû, le chemin ne compte plus.
    const missionId = await createMission("J3", 200000);
    const { contractId, jalonIds } = await createSignedContract(missionId, 0, [200000]);
    const jalonId = jalonIds[0];
    const emit = (progress: number) =>
      emitScopedRelease({
        contractId,
        jalonId,
        currency: "XOF",
        plafond: 200000,
        targetCumulative: progressiveReleaseTarget(200000, progress),
      });

    const amountOf = (r: Awaited<ReturnType<typeof emit>>) => (r.ok ? r.operation.amount : null);

    expect(amountOf(await emit(50))).toBe(100000);
    // Rejouer le MÊME palier ne verse rien de plus — quel qu'ait été le chemin entre-temps.
    expect(await emit(50)).toEqual({ ok: false, reason: "nothing_to_release" });
    // Et un palier supérieur ne verse QUE la différence, jamais sa part entière.
    expect(amountOf(await emit(75))).toBe(50000);
    expect(amountOf(await emit(100))).toBe(50000);
    // Plafond atteint : plus rien ne peut sortir, même en redemandant.
    expect(await emit(100)).toEqual({ ok: false, reason: "nothing_to_release" });

    const total = await prisma.pspEscrowOperation.aggregate({
      where: { jalonId, instructionType: "release", status: { in: ["pending", "confirmed"] } },
      _sum: { amount: true },
    });
    expect(total._sum.amount, "jamais plus que le montant du jalon").toBe(200000);
  });
});

describe("G8 — une libération refusée par le PSP ne condamne plus le jalon", () => {
  it("rend le jalon re-validable au lieu de le figer sur `valide`", async () => {
    // Défaut corrigé (F4) : après validation le jalon passe `valide` en attendant le webhook.
    // Si le PSP refusait, le jalon restait `valide` à vie — statut qu'aucune route n'accepte
    // (canDecideDeliverable exige `livrable_soumis`) : fonds immobilisés, aucune reprise.
    const missionId = await createMission("J1", 200000);
    const { contractId, jalonIds } = await createSignedContract(missionId, 0, [200000]);
    const jalonId = jalonIds[0];

    const release = await prisma.pspEscrowOperation.create({
      data: {
        contractId,
        jalonId,
        pspName: "psp-virtuelle",
        pspReference: `release_${randomUUID()}`,
        amount: 200000,
        currency: "XOF",
        instructionType: "release",
      },
    });
    await prisma.jalon.update({ where: { id: jalonId }, data: { status: "valide" } });

    expect((await operateVirtualPsp("fail", release.pspReference!)).ok).toBe(true);

    const jalon = await prisma.jalon.findUniqueOrThrow({ where: { id: jalonId } });
    expect(jalon.status).toBe("livrable_soumis");
    // Et le solde redevient libérable : `failed` est exclu des cumuls, donc rien n'est amputé.
    const encore = await emitScopedRelease({
      contractId,
      jalonId,
      currency: "XOF",
      plafond: 200000,
      targetCumulative: 200000,
    });
    expect(encore.ok && encore.operation.amount).toBe(200000);
  });
});

describe("G9 — le webhook ne rejoue pas un dénouement déjà acquis", () => {
  it("refuse un `failed` arrivant après un `confirmed`, et reste idempotent sur un rejeu identique", async () => {
    // Défaut corrigé (F5) : sans machine à états, un `failed` rejoué remettait une opération
    // CONFIRMÉE à `failed`. Comme tous les cumuls excluent `failed` (pour permettre la reprise),
    // le solde libérable se rouvrait — le montant pouvait repartir une seconde fois.
    const missionId = await createMission("J1", 200000);
    const { contractId, jalonIds } = await createSignedContract(missionId, 0, [200000]);
    const op = await prisma.pspEscrowOperation.create({
      data: {
        contractId,
        jalonId: jalonIds[0],
        pspName: "psp-virtuelle",
        pspReference: `release_${randomUUID()}`,
        amount: 200000,
        currency: "XOF",
        instructionType: "release",
      },
    });
    expect((await operateVirtualPsp("release", op.pspReference!)).ok).toBe(true);

    // Rejeu du MÊME dénouement : accepté sans rien réécrire.
    expect((await replayWebhook(op.pspReference!, "release_confirmed")).ok).toBe(true);
    // Dénouement CONTRAIRE : refusé.
    const contraire = await replayWebhook(op.pspReference!, "failed");
    expect(contraire.ok).toBe(false);
    expect(contraire.ok === false && contraire.error).toBe("operation_already_settled");

    const refreshed = await prisma.pspEscrowOperation.findUniqueOrThrow({ where: { id: op.id } });
    expect(refreshed.status).toBe("confirmed");
  });
});

describe("G10 — la médiation instruit le bon montant et rend la mission à son cycle de vie", () => {
  it("refuse l'ouverture sur une mission qui n'a rien à médier", async () => {
    const missionId = await createMission("J1", 200000);
    await createSignedContract(missionId, 0, [200000]);
    // Statut `proposition_acceptee` : aucun fonds engagé, rien à geler.
    authAs(clientId);
    const res = await mediationOpenPost(postReq({ reason: "Désaccord sur la qualité" }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("mission_not_mediable");
  });

  it("gèle ce qui est RÉELLEMENT séquestré, pas le budget publié", async () => {
    const missionId = await createMission("J1", 200000);
    // Prix contracté 150 000 (contre-proposition) alors que le budget publié vaut 200 000, et
    // 100 000 déjà libérés : le gel ne doit porter que sur les 50 000 restants.
    const { contractId, jalonIds } = await createSignedContract(missionId, 0, [150000]);
    await prisma.pspEscrowOperation.create({
      data: {
        contractId,
        jalonId: jalonIds[0],
        pspName: "psp-virtuelle",
        pspReference: `release_${randomUUID()}`,
        amount: 100000,
        currency: "XOF",
        instructionType: "release",
        status: "confirmed",
        pspConfirmedAt: new Date(),
      },
    });
    await prisma.mission.update({ where: { id: missionId }, data: { status: "livrable_soumis" } });

    authAs(clientId);
    const res = await mediationOpenPost(postReq({ reason: "Désaccord sur la finition" }), {
      params: Promise.resolve({ id: missionId }),
    });
    expect(res.status).toBe(200);

    const freeze = await prisma.pspEscrowOperation.findFirstOrThrow({
      where: { contractId, instructionType: "freeze" },
    });
    expect(freeze.amount, "le gel porte sur le solde séquestré").toBe(50000);

    // Et le statut d'avant est mémorisé pour être restauré à la clôture.
    const mediation = await prisma.mediation.findFirstOrThrow({ where: { contractId } });
    expect(mediation.previousStatus).toBe("livrable_soumis");
  });

  it("un refus clôt la médiation et rend son statut à la mission", async () => {
    const missionId = await createMission("J1", 200000);
    const { contractId, jalonIds } = await createSignedContract(missionId, 0, [200000]);
    await prisma.mission.update({ where: { id: missionId }, data: { status: "livrable_soumis" } });
    authAs(clientId);
    expect((await mediationOpenPost(postReq({ reason: "Désaccord de fond" }), { params: Promise.resolve({ id: missionId }) })).status).toBe(200);
    const mediation = await prisma.mediation.findFirstOrThrow({ where: { contractId } });
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })).status).toBe("mediation_ouverte");

    authAs(providerId);
    const res = await respondPost(postReq({ accept: false }), { params: Promise.resolve({ id: mediation.id }) });
    expect(res.status).toBe(200);

    const closed = await prisma.mediation.findUniqueOrThrow({ where: { id: mediation.id } });
    expect(closed.outcome).toBe("no_agreement");
    expect(closed.closedAt).not.toBeNull();
    // Le point du correctif : la mission n'est plus prisonnière de `mediation_ouverte`.
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })).status).toBe("livrable_soumis");
    expect(jalonIds).toHaveLength(1);
  });

  it("un accord libère le montant de la RÉSOLUTION, borné par le solde séquestré", async () => {
    const missionId = await createMission("J1", 200000);
    const { contractId } = await createSignedContract(missionId, 0, [200000]);
    await prisma.mission.update({ where: { id: missionId }, data: { status: "livrable_soumis" } });
    authAs(clientId);
    expect((await mediationOpenPost(postReq({ reason: "Litige sur le périmètre" }), { params: Promise.resolve({ id: missionId }) })).status).toBe(200);
    const mediation = await prisma.mediation.findFirstOrThrow({ where: { contractId } });

    authAs(adminId);
    const proposeRes = await proposePost(
      postReq({ proposedResolution: "Versement partiel de 120 000 au prestataire", justification: "Travaux partiellement exécutés", resolutionAmount: 120000 }),
      { params: Promise.resolve({ id: mediation.id }) }
    );
    expect(proposeRes.status).toBe(200);

    authAs(clientId);
    expect((await respondPost(postReq({ accept: true }), { params: Promise.resolve({ id: mediation.id }) })).status).toBe(200);
    authAs(providerId);
    const res = await respondPost(postReq({ accept: true }), { params: Promise.resolve({ id: mediation.id }) });
    expect(res.status).toBe(200);
    // 120 000, et non les 200 000 du budget publié comme avant le correctif.
    expect((await res.json()).releasedAmount).toBe(120000);

    const release = await prisma.pspEscrowOperation.findFirstOrThrow({
      where: { contractId, instructionType: "release", jalonId: null },
    });
    expect(release.amount).toBe(120000);
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })).status).toBe("livrable_soumis");
  });
});
