/**
 * WORKFLOW COMPLET — suite : les tâches automatiques (2026-09-16).
 *
 * `workflow-complet.e2e.test.ts` (P1–P6) et `workflow-incidents.e2e.test.ts` (W1–W9) traversent
 * les huit modes du catalogue par les routes que quelqu'un CLIQUE. Ce fichier traverse les cinq
 * routes que PERSONNE ne clique : les crons. Aucune n'avait de test — ni la garde d'accès, ni la
 * requête de sélection. Or ce sont elles qui annulent des contrats et rendent de l'argent sans
 * qu'aucune partie n'agisse ; une garde absente les ouvre à l'Internet entier, et un `where` trop
 * large frappe des dossiers vivants.
 *
 *   X1  Garde d'accès des cinq routes — sans jeton, mauvais jeton, secret non configuré
 *   X2  contract-expirations — le client ne contre-signe pas sous 48h
 *   X3  devis-expirations — la négociation dépasse la date d'expiration de la mission
 *   X4  gig-order-expirations — le prestataire ne signe pas sous 24h, le client est remboursé
 *
 * Chaque balayage est vérifié sur trois plans : il prend ce qu'il doit prendre, il LAISSE ce qu'il
 * ne doit pas prendre (un témoin encore dans les délais, à chaque fois), et repasser ne refait pas
 * le geste. Le temps est simulé en reculant la date de signature — la seule façon de traverser un
 * délai de 48h dans une suite qui dure 30 secondes.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { GET as contractExpirationsGet } from "@/app/api/cron/contract-expirations/route";
import { GET as devisExpirationsGet } from "@/app/api/cron/devis-expirations/route";
import { GET as gigOrderExpirationsGet } from "@/app/api/cron/gig-order-expirations/route";
import { GET as residualRefundsGet } from "@/app/api/cron/residual-refunds/route";
import { GET as tacitAcceptanceGet } from "@/app/api/cron/tacit-acceptance/route";
import { POST as missionPost } from "@/app/api/missions/route";
import { POST as proposalPost } from "@/app/api/missions/[id]/proposals/route";
import { POST as acceptPost } from "@/app/api/missions/[id]/proposals/[proposalId]/accept/route";
import { POST as devisPost } from "@/app/api/missions/[id]/devis/route";
import { POST as contractPost } from "@/app/api/missions/[id]/contract/route";
import { POST as certPost } from "@/app/api/signature/certificate/route";
import { POST as signPost } from "@/app/api/signature/sign/route";
import { POST as gigPost } from "@/app/api/gigs/route";
import { POST as gigPurchasePost } from "@/app/api/gigs/[id]/purchase/route";
import { POST as gigSignPost } from "@/app/api/gigs/orders/[orderId]/sign/route";
import { prisma } from "@/lib/db";
import { COUNTER_SIGN_DEADLINE_MS, cancelExpiredContract } from "@/lib/contract-expiry";
import { PROVIDER_SIGN_DEADLINE_MS, refundExpiredOrder } from "@/lib/gig-expiry";
import { gigHeldBalance } from "@/lib/gig-completion";

const RUN = Date.now();
const PASSPHRASE = "passphrase-crons-2026";
const SECRET = `cron-secret-${RUN}`;
const LONG = 120_000;
const HOUR = 60 * 60 * 1000;

const ids = {
  client: "",
  provider: "",
  temoinProvider: "",
  devisProvider: "",
  clientCert: "",
  providerCert: "",
  temoinCert: "",
};
const missionIds: string[] = [];
const contractIds: string[] = [];
const gigIds: string[] = [];
const report: Record<string, unknown>[] = [];

// ── Outils ────────────────────────────────────────────────────────────────────────────────────

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}

const postReq = (body: unknown) =>
  new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const at = (id: string) => ({ params: Promise.resolve({ id }) });

/** Requête de cron : `Bearer <secret>` par défaut, en-tête libre sinon (y compris absent). */
const cronReq = (authorization: string | null = `Bearer ${SECRET}`) =>
  new Request("http://localhost/api/cron", authorization === null ? undefined : { headers: { authorization } });

async function expectOk(res: Response, label: string, codes = [200, 201]) {
  if (!codes.includes(res.status)) throw new Error(`${label} → HTTP ${res.status} : ${await res.clone().text()}`);
  return res;
}

async function publish(body: Record<string, unknown>) {
  authAs(ids.client);
  const res = await expectOk(
    await missionPost(
      postReq({
        description: "Mission du test des tâches automatiques.",
        domaine: "developpement",
        mode: "distance",
        currency: "XOF",
        delaiJours: 20,
        professionalType: "EXPERT_DIGITAL",
        level: "Senior",
        status: "publiee",
        ...body,
      })
    ),
    "publication"
  );
  const { id } = (await res.json()) as { id: string };
  missionIds.push(id);
  return prisma.mission.findUniqueOrThrow({ where: { id } });
}

async function applyAndAccept(missionId: string, providerId: string, montant: number) {
  authAs(providerId);
  const p = await expectOk(await proposalPost(postReq({ montant }), at(missionId)), "candidature");
  const proposalId = (await p.json()).id as string;
  authAs(ids.client);
  await expectOk(await acceptPost(postReq({}), { params: Promise.resolve({ id: missionId, proposalId }) }), "acceptation");
}

/** Contrat généré puis signé par le SEUL prestataire — l'état qu'attend le délai de 48h. */
async function contractSignedByProviderOnly(missionId: string, providerId: string, certificateId: string) {
  authAs(ids.client);
  const c = await expectOk(await contractPost(postReq({}), at(missionId)), "génération du contrat");
  const contractId = (await c.json()).id as string;
  contractIds.push(contractId);
  authAs(providerId);
  await expectOk(await signPost(postReq({ contractId, certificateId, passphrase: PASSPHRASE })), "signature prestataire");
  const signed = await prisma.prestationContract.findUniqueOrThrow({ where: { id: contractId } });
  expect(signed.providerSignedAt, "le prestataire a bien signé 1/2").not.toBeNull();
  expect(signed.clientSignedAt, "le client n'a pas contre-signé").toBeNull();
  return contractId;
}

/** Recule une date en base : la seule façon de franchir un délai de 24h ou 48h en séquence. */
function backdate(ms: number) {
  return new Date(Date.now() - ms);
}

// ── Mise en place ─────────────────────────────────────────────────────────────────────────────

const previousSecret = process.env.CRON_SECRET;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  process.env.CRON_SECRET = SECRET;

  let n = 0;
  const mk = (key: string, extra: Record<string, unknown>) =>
    prisma.user.create({
      data: {
        email: `cron-${key}-${RUN}@flexwork.test`,
        tel: `+229${RUN}${++n}7`,
        status: "active",
        country: "BJ",
        firstname: "Crons",
        lastname: key,
        kycStatus: "verifie",
        role: "client",
        ...extra,
      },
    });
  ids.client = (await mk("client", {})).id;
  ids.provider = (await mk("prestataire", { role: "expert_digital" })).id;
  // Le témoin non expiré a besoin de SON prestataire : un contrat par mission, et la règle
  // d'exclusivité interdit au même prestataire deux négociations actives.
  ids.temoinProvider = (await mk("temoin", { role: "expert_digital" })).id;
  ids.devisProvider = (await mk("devis", { role: "expert_digital" })).id;

  await prisma.featureFlag.upsert({
    where: { key_zone: { key: "psp_montage_valide", zone: "BJ" } },
    update: { enabled: true },
    create: { key: "psp_montage_valide", zone: "BJ", enabled: true },
  });

  const cert = async (userId: string, label: string) => {
    authAs(userId);
    const res = await expectOk(
      await certPost(postReq({ commonName: `Crons ${label}`, email: `cron-${label}-${RUN}@flexwork.test`, passphrase: PASSPHRASE })),
      "certificat",
      [201]
    );
    return (await res.json()).data.id as string;
  };
  ids.providerCert = await cert(ids.provider, "prestataire");
  ids.clientCert = await cert(ids.client, "client");
  ids.temoinCert = await cert(ids.temoinProvider, "temoin");
}, LONG);

afterAll(async () => {
  if (previousSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = previousSecret;

  const users = [ids.client, ids.provider, ids.temoinProvider, ids.devisProvider].filter(Boolean);
  if (report.length) {
    console.log("\n══ WORKFLOW — TÂCHES AUTOMATIQUES — état final ══");
    console.table(report);
  }
  await prisma.pspEventLog.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contractAuditEntry.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.contractSignature.deleteMany({ where: { contractId: { in: contractIds } } });
  await prisma.missionNotification.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  for (const gigId of gigIds) {
    await prisma.gigOrderAuditEntry.deleteMany({ where: { order: { gigId } } });
    await prisma.gigOrderSignature.deleteMany({ where: { order: { gigId } } });
    await prisma.pspEscrowOperation.deleteMany({ where: { order: { gigId } } });
    await prisma.gigOrder.deleteMany({ where: { gigId } });
    await prisma.gig.deleteMany({ where: { id: gigId } });
  }
  await prisma.digitalCertificate.deleteMany({ where: { userId: { in: users } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}, LONG);

// ── X1 — La garde d'accès ─────────────────────────────────────────────────────────────────────

describe("X1 — les cinq routes de cron n'obéissent qu'au porteur du secret", () => {
  const routes: [string, (req: Request) => Promise<Response>][] = [
    ["contract-expirations", contractExpirationsGet],
    ["devis-expirations", devisExpirationsGet],
    ["gig-order-expirations", gigOrderExpirationsGet],
    ["residual-refunds", residualRefundsGet],
    ["tacit-acceptance", tacitAcceptanceGet],
  ];

  it.each(routes)("%s — sans en-tête, avec un mauvais jeton, ou sans secret configuré : 401", async (_nom, handler) => {
    expect((await handler(cronReq(null))).status).toBe(401);
    expect((await handler(cronReq("Bearer mauvais-jeton"))).status).toBe(401);
    // Le secret lui-même en clair, sans le schéma « Bearer » : refusé aussi.
    expect((await handler(cronReq(SECRET))).status).toBe(401);

    // CRON_SECRET absent de l'environnement : la route se FERME au lieu de s'ouvrir. C'est le
    // point le plus important de cette garde — un déploiement où la variable manque ne doit
    // jamais laisser passer une requête, fût-elle porteuse d'un « Bearer undefined ».
    delete process.env.CRON_SECRET;
    try {
      expect((await handler(cronReq("Bearer undefined"))).status).toBe(401);
      expect((await handler(cronReq(null))).status).toBe(401);
    } finally {
      process.env.CRON_SECRET = SECRET;
    }
  });

  it("le bon jeton passe sur les cinq routes", async () => {
    for (const [nom, handler] of routes) {
      const res = await handler(cronReq());
      expect(res.status, nom).toBe(200);
      expect(await res.json(), nom).toBeTypeOf("object");
    }
  });
});

// ── X2 — contract-expirations ─────────────────────────────────────────────────────────────────

describe("X2 — contract-expirations : le client qui ne contre-signe pas libère le prestataire", () => {
  it("48h dépassées → contrat annulé, signature effacée, audit et notifications ; le témoin récent est épargné", async () => {
    const mission = await publish({ titre: `CRON contre-signature ${RUN}`, budgetType: "FIXED", budget: 80_000, financingModeKey: "F2" });
    await applyAndAccept(mission.id, ids.provider, 80_000);
    const contractId = await contractSignedByProviderOnly(mission.id, ids.provider, ids.providerCert);

    // Témoin : même situation exactement, mais signée il y a une heure. Il ne doit pas bouger.
    const temoinMission = await publish({ titre: `CRON témoin 48h ${RUN}`, budgetType: "FIXED", budget: 40_000, financingModeKey: "F2" });
    await applyAndAccept(temoinMission.id, ids.temoinProvider, 40_000);
    const temoinId = await contractSignedByProviderOnly(temoinMission.id, ids.temoinProvider, ids.temoinCert);

    // Le temps passe pour l'un seulement : 49h, soit une heure de trop.
    await prisma.prestationContract.update({
      where: { id: contractId },
      data: { providerSignedAt: backdate(COUNTER_SIGN_DEADLINE_MS + HOUR) },
    });
    await prisma.prestationContract.update({
      where: { id: temoinId },
      data: { providerSignedAt: backdate(HOUR) },
    });

    const { cancelled } = await (await expectOk(await contractExpirationsGet(cronReq()), "balayage des contre-signatures")).json();
    expect(cancelled, "au moins le contrat expiré ; d'autres suites peuvent en apporter").toBeGreaterThanOrEqual(1);

    const annule = await prisma.prestationContract.findUniqueOrThrow({ where: { id: contractId } });
    expect(annule.providerSignedAt, "la signature du prestataire est effacée : le flux peut redémarrer").toBeNull();
    expect(annule.clientSignedAt).toBeNull();
    expect(await prisma.contractSignature.count({ where: { contractId } }), "le compteur de signatures est remis à zéro").toBe(0);

    const audit = await prisma.contractAuditEntry.findMany({ where: { contractId }, orderBy: { createdAt: "asc" } });
    expect(audit.map((a) => a.event)).toContain("CONTRACT_EXPIRED");

    // Les DEUX parties sont prévenues — celle qui a signé pour rien, et celle qui a laissé filer.
    const notifs = await prisma.missionNotification.findMany({ where: { missionId: mission.id, type: "contract_expired" } });
    expect(new Set(notifs.map((n) => n.userId))).toEqual(new Set([ids.provider, ids.client]));

    // Le contrat existe toujours : rien à régénérer, il attend seulement d'être re-signé.
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: mission.id } })).status).toBe("contrat_genere");

    // Le témoin, signé il y a une heure, est intact.
    const temoin = await prisma.prestationContract.findUniqueOrThrow({ where: { id: temoinId } });
    expect(temoin.providerSignedAt, "encore dans les 48h : le balayage ne l'a pas touché").not.toBeNull();
    expect(await prisma.contractSignature.count({ where: { contractId: temoinId } })).toBe(1);

    // Deux verrous protègent ce témoin, et ils sont vérifiés SÉPARÉMENT : la requête du cron ne
    // le sélectionne pas (ci-dessus), et le module refuse de l'annuler même nommément désigné.
    // Sans cette seconde assertion, perdre l'un des deux passerait inaperçu — l'autre couvrirait.
    expect(await cancelExpiredContract(temoinId), "le module refuse un contrat encore dans les délais").toBe(false);
    expect((await prisma.prestationContract.findUniqueOrThrow({ where: { id: temoinId } })).providerSignedAt).not.toBeNull();

    // Repasser n'annule pas deux fois : plus aucun contrat de ce test n'est sélectionnable, et la
    // chaîne d'audit ne gagne pas un second CONTRACT_EXPIRED.
    await expectOk(await contractExpirationsGet(cronReq()), "second balayage");
    expect(await prisma.contractAuditEntry.count({ where: { contractId, event: "CONTRACT_EXPIRED" } })).toBe(1);

    report.push({ tâche: "contract-expirations", pris: "contrat signé 1/2 depuis 49h", épargné: "signé 1/2 depuis 1h", effet: "signature effacée, 2 notifications" });
  }, LONG);
});

// ── X3 — devis-expirations ────────────────────────────────────────────────────────────────────

describe("X3 — devis-expirations : la date d'expiration de la mission ferme la négociation", () => {
  it("la négociation d'une mission expirée est annulée ; celle d'une mission encore ouverte continue", async () => {
    const mission = await publish({ titre: `CRON devis expiré ${RUN}`, budgetType: "QUOTE", financingModeKey: "J1" });
    authAs(ids.devisProvider);
    const devis = await (
      await expectOk(
        await devisPost(
          postReq({
            lineItems: [{ description: "Étude et livraison", quantity: 1, unit: "forfait", unitPrice: 120_000 }],
            delay: "10 jours",
            tvaRate: 0,
            laborCost: 0,
          }),
          at(mission.id)
        ),
        "devis"
      )
    ).json();
    const proposalId = devis.proposalId as string;
    expect((await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } })).status).toBe("en_negociation");

    // Témoin : une candidature ordinaire sur une mission dont la date d'expiration est à venir.
    const temoinMission = await publish({ titre: `CRON devis ouvert ${RUN}`, budgetType: "FIXED", budget: 50_000, financingModeKey: "F2" });
    authAs(ids.temoinProvider);
    const temoinProposalId = (await (await expectOk(await proposalPost(postReq({ montant: 50_000 }), at(temoinMission.id)), "candidature témoin")).json()).id as string;
    await prisma.missionProposal.update({ where: { id: temoinProposalId }, data: { status: "preselectionnee" } });
    await prisma.mission.update({ where: { id: temoinMission.id }, data: { dateExpiration: new Date(Date.now() + 7 * 24 * HOUR) } });

    // La date d'expiration de la mission est franchie — sur elle seule, pas sur le compteur de
    // rounds : le dernier round doit rester utilisable tant que la date tient.
    await prisma.mission.update({ where: { id: mission.id }, data: { dateExpiration: backdate(HOUR) } });

    const { cancelled } = await (await expectOk(await devisExpirationsGet(cronReq()), "balayage des devis")).json();
    expect(cancelled).toBeGreaterThanOrEqual(1);

    expect((await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } })).status).toBe("annulee_definitive");
    expect(
      (await prisma.missionProposal.findUniqueOrThrow({ where: { id: temoinProposalId } })).status,
      "mission encore ouverte : la présélection survit"
    ).toBe("preselectionnee");

    // Le prestataire libéré peut repartir ailleurs : l'exclusivité ne le retient plus.
    const encoreActives = await prisma.missionProposal.count({
      where: { providerId: ids.devisProvider, status: { in: ["preselectionnee", "en_negociation", "devis_valide", "acceptee"] } },
    });
    expect(encoreActives, "plus aucune négociation active ne bloque ce prestataire").toBe(0);

    // Second passage : rien de nouveau à annuler dans ce périmètre.
    await expectOk(await devisExpirationsGet(cronReq()), "second balayage");
    expect((await prisma.missionProposal.findUniqueOrThrow({ where: { id: temoinProposalId } })).status).toBe("preselectionnee");

    report.push({ tâche: "devis-expirations", pris: "négociation sur mission expirée", épargné: "présélection sur mission ouverte", effet: "annulee_definitive, prestataire libéré" });
  }, LONG);
});

// ── X4 — gig-order-expirations ────────────────────────────────────────────────────────────────

describe("X4 — gig-order-expirations : le prestataire muet sous 24h rend l'argent au client", () => {
  it("commande signée 1/2 depuis 25h → remboursée et séquestre vidé ; la commande active est épargnée", async () => {
    authAs(ids.provider);
    const gigId = (await (
      await expectOk(
        await gigPost(postReq({ titre: `Refonte de logo ${RUN}`, description: "Refonte complète d'un logo et déclinaisons.", domaine: "expert_digital", prix: 45_000, delaiJours: 5, status: "publie" })),
        "publication du Gig",
        [201]
      )
    ).json()).id as string;
    gigIds.push(gigId);

    // Commande A : le client signe et paie, le prestataire ne signe jamais.
    authAs(ids.client);
    const abandonnee = (await (await expectOk(await gigPurchasePost(postReq({}), at(gigId)), "achat A", [201])).json()).orderId as string;
    await expectOk(await gigSignPost(postReq({ certificateId: ids.clientCert, passphrase: PASSPHRASE }), { params: Promise.resolve({ orderId: abandonnee }) }), "signature client A");
    expect(await gigHeldBalance(abandonnee), "les fonds du client sont bien sous séquestre").toBe(45_000);

    // Commande B : témoin signé des deux côtés — elle n'est plus `client_signed`, donc hors de
    // portée du balayage. C'est le garde d'idempotence du module, vérifié ici de bout en bout.
    const active = (await (await expectOk(await gigPurchasePost(postReq({}), at(gigId)), "achat B", [201])).json()).orderId as string;
    await expectOk(await gigSignPost(postReq({ certificateId: ids.clientCert, passphrase: PASSPHRASE }), { params: Promise.resolve({ orderId: active }) }), "signature client B");
    authAs(ids.provider);
    await expectOk(await gigSignPost(postReq({ certificateId: ids.providerCert, passphrase: PASSPHRASE }), { params: Promise.resolve({ orderId: active }) }), "signature prestataire B");
    expect((await prisma.gigOrder.findUniqueOrThrow({ where: { id: active } })).status).toBe("active");

    // 25h passent pour la commande abandonnée. Le témoin actif est reculé AUSSI : s'il survit,
    // c'est bien son statut qui le protège et non l'heure de sa signature.
    await prisma.gigOrder.update({ where: { id: abandonnee }, data: { clientSignedAt: backdate(PROVIDER_SIGN_DEADLINE_MS + HOUR) } });
    await prisma.gigOrder.update({ where: { id: active }, data: { clientSignedAt: backdate(PROVIDER_SIGN_DEADLINE_MS + HOUR) } });

    const { refunded } = await (await expectOk(await gigOrderExpirationsGet(cronReq()), "balayage des commandes Gig")).json();
    expect(refunded).toBeGreaterThanOrEqual(1);

    const rendue = await prisma.gigOrder.findUniqueOrThrow({ where: { id: abandonnee } });
    expect(rendue.status).toBe("refunded");
    expect(rendue.refundedAt).not.toBeNull();
    expect(await gigHeldBalance(abandonnee), "le séquestre est vidé : plus d'argent fantôme").toBe(0);

    // La plateforme ne garde jamais les fonds : une instruction de remboursement est écrite.
    const remboursements = await prisma.pspEscrowOperation.findMany({ where: { orderId: abandonnee, instructionType: "refund" } });
    expect(remboursements).toHaveLength(1);
    expect(remboursements[0]).toMatchObject({ amount: 45_000, status: "confirmed", sourceType: "gig_order" });
    expect((await prisma.gigOrderAuditEntry.findMany({ where: { orderId: abandonnee } })).map((a) => a.event)).toContain("GIG_ORDER_EXPIRED");

    expect((await prisma.gigOrder.findUniqueOrThrow({ where: { id: active } })).status, "signée des deux côtés : intouchable").toBe("active");
    expect(await gigHeldBalance(active)).toBe(45_000);

    // Même précaution qu'en X2 : le statut la protège dans la requête du cron ET dans le module.
    // Les deux sont interrogés, sinon la chute de l'un resterait masquée par l'autre.
    expect(await refundExpiredOrder(active), "le module refuse une commande déjà signée 2/2").toBe(false);
    expect((await prisma.gigOrder.findUniqueOrThrow({ where: { id: active } })).status).toBe("active");

    // Repasser ne rembourse pas deux fois — le garde porte sur le statut, pas sur la date.
    await expectOk(await gigOrderExpirationsGet(cronReq()), "second balayage");
    expect(await prisma.pspEscrowOperation.count({ where: { orderId: abandonnee, instructionType: "refund" } })).toBe(1);

    report.push({ tâche: "gig-order-expirations", pris: "commande signée 1/2 depuis 25h", épargné: "commande active (2/2)", effet: "45 000 rendus, séquestre à 0" });
  }, LONG);
});
