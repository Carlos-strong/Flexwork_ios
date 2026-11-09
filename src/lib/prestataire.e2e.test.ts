/**
 * Côté PRESTATAIRE — devis, candidature, révision et relevés de présence, par les vraies routes.
 *
 * Plan de tests (PLAN_TESTS_MODELE_PAIEMENT.md) : P-F09, P-R02, P-R03, P-N01 à P-N05, P-N07,
 * P-N08, S03, T-P05 à T-P08, T-R02, T-R06.
 *
 * Un prestataire par mission : la règle d'exclusivité interdit à un même prestataire deux
 * négociations actives en parallèle. Une soumission REFUSÉE ne crée pas de candidature, ce qui
 * permet d'enchaîner les cas de refus avec le même prestataire sur la même mission.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as missionPost } from "@/app/api/missions/route";
import { POST as devisPost } from "@/app/api/missions/[id]/devis/route";
import { POST as proposalPost } from "@/app/api/missions/[id]/proposals/route";
import { POST as acceptPost } from "@/app/api/missions/[id]/proposals/[proposalId]/accept/route";
import { POST as devisValidatePost } from "@/app/api/missions/[id]/proposals/[proposalId]/devis/validate/route";
import { POST as requestRevisionPost } from "@/app/api/missions/[id]/proposals/[proposalId]/devis/request-revision/route";
import { POST as contractPost } from "@/app/api/missions/[id]/contract/route";
import { POST as attendancePost } from "@/app/api/missions/[id]/attendance/route";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const LONG = 120_000;
const LIGNES = [
  { description: "Fournitures", quantity: 1, unit: "forfait", unitPrice: 100_000 },
  { description: "Pose", quantity: 1, unit: "forfait", unitPrice: 50_000 },
];

let clientId = "";
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

async function publier(titre: string, body: Record<string, unknown>) {
  authAs(clientId);
  const res = await expectOk(
    await missionPost(
      postReq({
        titre: `${titre} ${RUN}`,
        description: "Mission de test côté prestataire : devis, candidature et relevés.",
        domaine: "batiment",
        mode: "distance",
        currency: "XOF",
        delaiJours: 20,
        status: "publiee",
        ...body,
      })
    ),
    "publication"
  );
  const { id } = await res.json();
  missionIds.push(id);
  return id as string;
}

const devis = (providerId: string, missionId: string, extra: Record<string, unknown> = {}) => {
  authAs(providerId);
  return devisPost(postReq({ lineItems: LIGNES, delay: "20 jours", tvaRate: 18, laborCost: 0, ...extra }), at(missionId));
};
const modeDuDevis = async (proposalId: string) =>
  ((await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } })).devisData as { financingModeKey?: string }).financingModeKey;

async function demanderRevision(missionId: string, proposalId: string) {
  authAs(clientId);
  await expectOk(await requestRevisionPost(postReq({ message: "Merci de revoir le devis." }), atProposal(missionId, proposalId)), "demande de révision");
}

beforeAll(async () => {
  let n = 0;
  const mk = (key: string, role: string) =>
    prisma.user.create({
      data: {
        email: `pr-${key}-${RUN}@flexwork.test`,
        tel: `+229${RUN}${++n}2`,
        status: "active",
        country: "BJ",
        kycStatus: "verifie",
        role: role as "client",
      },
    });
  clientId = (await mk("client", "client")).id;
  for (const key of ["fixe", "garde", "change", "refus", "fixeS2H", "temps", "deduit", "ancien"]) {
    presta[key] = (await mk(key, "expert_digital")).id;
  }
}, LONG);

afterAll(async () => {
  const users = [clientId, ...Object.values(presta)];
  const contrats = await prisma.prestationContract.findMany({ where: { missionId: { in: missionIds } }, select: { id: true } });
  await prisma.contractAuditEntry.deleteMany({ where: { contractId: { in: contrats.map((c) => c.id) } } });
  await prisma.missionNotification.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}, LONG);

describe("devis détaillé — le prestataire fixe le modèle de paiement", () => {
  it("P-F09 — devis à prix fixe complet : accepté, modèle F2 enregistré", async () => {
    const missionId = await publier("PR Fixe", { budgetType: "QUOTE" });
    const res = await expectOk(await devis(presta.fixe, missionId, { financingModeKey: "F2" }), "devis");
    const { proposalId } = await res.json();
    expect(await modeDuDevis(proposalId)).toBe("F2");
  });

  it("P-R02 — révision resoumise sans modèle : celui du round précédent est conservé", async () => {
    const missionId = await publier("PR Garde", { budgetType: "QUOTE" });
    const { proposalId } = await (await expectOk(await devis(presta.garde, missionId, { financingModeKey: "J3" }), "devis")).json();
    await demanderRevision(missionId, proposalId);
    await expectOk(await devis(presta.garde, missionId), "révision sans modèle");
    const proposal = await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } });
    expect(proposal.roundActuel).toBe(2);
    expect(await modeDuDevis(proposalId)).toBe("J3");
  });

  it("S03 — devis validé : le prestataire ne peut plus en changer le modèle", async () => {
    const missionId = missionIds[1]; // « PR Garde », devis J3 en round 2
    const proposal = await prisma.missionProposal.findFirstOrThrow({ where: { missionId } });
    authAs(clientId);
    await expectOk(await devisValidatePost(postReq(), atProposal(missionId, proposal.id)), "validation du devis");

    const res = await devis(presta.garde, missionId, { financingModeKey: "F2" });
    expect(res.status).toBe(409);
    expect(["mission_not_open", "proposal_closed"]).toContain((await res.json()).error);
    expect(await modeDuDevis(proposal.id)).toBe("J3");
  });

  it("P-R03 — révision qui passe de J1 à prix fixe : le round 2 porte F2", async () => {
    const missionId = await publier("PR Change", { budgetType: "QUOTE" });
    const { proposalId } = await (await expectOk(await devis(presta.change, missionId, { financingModeKey: "J1" }), "devis")).json();
    await demanderRevision(missionId, proposalId);
    await expectOk(await devis(presta.change, missionId, { financingModeKey: "F2" }), "révision");
    expect(await modeDuDevis(proposalId)).toBe("F2");
    const revisions = await prisma.devisRevision.findMany({ where: { proposalId }, orderBy: { roundNumber: "asc" } });
    expect(revisions.map((r) => (r.devisData as { financingModeKey: string }).financingModeKey)).toEqual(["J1", "F2"]);
  });

  describe("soumissions refusées", () => {
    let missionId = "";
    beforeAll(async () => {
      missionId = await publier("PR Refus", { budgetType: "QUOTE" });
    });
    const erreur = async (extra: Record<string, unknown>, lignes = LIGNES) => {
      authAs(presta.refus);
      const res = await devisPost(postReq({ lineItems: lignes, delay: "20 jours", tvaRate: 18, laborCost: 0, ...extra }), at(missionId));
      return { status: res.status, error: (await res.json()).error as string };
    };

    it("P-N01 — sans modèle, sur une mission qui n'en porte pas : refusé", async () => {
      expect(await erreur({})).toEqual({ status: 400, error: "payment_mode_required" });
    });

    it("P-N02 — modèle inconnu : refusé à la validation du schéma", async () => {
      expect(await erreur({ financingModeKey: "ZZ" })).toEqual({ status: 400, error: "invalid_payload" });
    });

    it("P-N03 — modèle indisponible (F3) : refusé", async () => {
      expect(await erreur({ financingModeKey: "F3" })).toEqual({ status: 400, error: "payment_mode_required" });
    });

    it("P-N04 — mode au temps (S2J) dans un devis : refusé", async () => {
      expect(await erreur({ financingModeKey: "S2J" })).toEqual({ status: 400, error: "payment_mode_required" });
    });

    it("P-N05 — retenue de garantie (J4) sur un poste unique : refusé", async () => {
      expect(await erreur({ financingModeKey: "J4" }, [LIGNES[0]])).toEqual({ status: 400, error: "retention_requires_two_lines" });
    });

    it("…et aucune candidature n'a été créée par ces refus", async () => {
      expect(await prisma.missionProposal.count({ where: { missionId, providerId: presta.refus } })).toBe(0);
    });
  });
});

describe("candidature à prix fixe et au temps", () => {
  it("P-N07 — mode au temps envoyé sur une mission à prix fixe : refusé", async () => {
    const missionId = await publier("PR Fixe S2H", { budgetType: "FIXED", budget: 120_000 });
    authAs(presta.fixeS2H);
    const res = await proposalPost(postReq({ montant: 120_000, financingModeKey: "S2H" }), at(missionId));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("payment_mode_invalid");
  });

  it(
    "P-N08 / T-P08 — mission au temps : un modèle J1 envoyé est ignoré, le contrat reste au temps",
    async () => {
      const missionId = await publier("PR Temps", { budgetType: "RATE", financingModeKey: "S2J", timeRate: 7_500, timeMaxQuantity: 20 });
      authAs(presta.temps);
      const res = await expectOk(await proposalPost(postReq({ montant: 0, unitRate: 8_000, financingModeKey: "J1" }), at(missionId)), "candidature");
      const proposalId = (await res.json()).id as string;
      const proposal = await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } });
      expect(proposal).toMatchObject({ unitRate: 8_000, montant: 160_000 });
      expect((proposal.devisData as { financingModeKey?: string }).financingModeKey).toBeUndefined();

      authAs(clientId);
      await expectOk(await acceptPost(postReq(), atProposal(missionId, proposalId)), "acceptation");
      const contrat = await (await expectOk(await contractPost(postReq(), at(missionId)), "contrat")).json();
      const termes = await prisma.spotTimeTerms.findUniqueOrThrow({ where: { contractId: contrat.id } });
      expect(termes).toMatchObject({ rateUnit: "day", rate: 8_000, maxAmount: 160_000 });
      expect(await prisma.jalon.count({ where: { contractId: contrat.id } })).toBe(0);
    },
    LONG
  );

  it("T-P06 puis T-P05 — ni montant ni tarif : refusé ; montant seul : tarif déduit du plafond", async () => {
    const missionId = await publier("PR Déduit", { budgetType: "RATE", financingModeKey: "S2J", timeRate: 7_500, timeMaxQuantity: 20 });
    authAs(presta.deduit);
    const rien = await proposalPost(postReq({ montant: 0 }), at(missionId));
    expect(rien.status).toBe(400);
    expect((await rien.json()).error).toBe("unit_rate_required");

    const res = await expectOk(await proposalPost(postReq({ montant: 150_000 }), at(missionId)), "candidature au plafond");
    const proposal = await prisma.missionProposal.findUniqueOrThrow({ where: { id: (await res.json()).id } });
    expect(proposal).toMatchObject({ montant: 150_000, unitRate: 7_500 });
  });

  it("T-P07 — mission au temps ancienne, sans quantité maximale : refusé", async () => {
    const missionId = await publier("PR Ancien", { budgetType: "RATE", financingModeKey: "S2J", timeRate: 7_500, timeMaxQuantity: 20 });
    // Mission publiée avant que les conditions au temps existent : pas de quantité maximale.
    await prisma.mission.update({ where: { id: missionId }, data: { timeMaxQuantity: null } });
    authAs(presta.ancien);
    const res = await proposalPost(postReq({ montant: 0, unitRate: 8_000 }), at(missionId));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("time_terms_missing");
  });
});

describe("relevés de présence — le prestataire et lui seul déclare", () => {
  const PERIODE = { periodStart: "2026-11-02T00:00:00.000Z", periodEnd: "2026-11-02T23:59:59.999Z", declaredQuantity: 1 };
  let missionId = "";
  beforeAll(async () => {
    // Contrat au temps signé de la mission « PR Temps » (P-N08), conclu avec presta.temps.
    missionId = missionIds[5];
    await prisma.prestationContract.update({ where: { missionId }, data: { clientSignedAt: new Date(), providerSignedAt: new Date() } });
  });

  it("T-R02 — le client ne déclare pas à la place du prestataire", async () => {
    authAs(clientId);
    const res = await attendancePost(postReq(PERIODE), at(missionId));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("worker_only");
  });

  it("T-R06 — période invalide (fin avant début, ou date absente) : refusée", async () => {
    authAs(presta.temps);
    const inversee = await attendancePost(
      postReq({ periodStart: "2026-11-03T23:59:59.999Z", periodEnd: "2026-11-03T00:00:00.000Z", declaredQuantity: 1 }),
      at(missionId)
    );
    expect(inversee.status).toBe(400);
    expect((await inversee.json()).error).toBe("invalid_period");
    const absente = await attendancePost(postReq({ periodStart: "2026-11-03T00:00:00.000Z", declaredQuantity: 1 }), at(missionId));
    expect(absente.status).toBe(400);

    // Une période valide passe : la garde ne bloque que l'incohérent.
    expect((await attendancePost(postReq(PERIODE), at(missionId))).status).toBe(201);
  });
});
