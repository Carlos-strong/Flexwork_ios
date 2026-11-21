/**
 * Une seule candidature par prestataire et par mission (2026-11-10), par les vraies routes.
 *
 * Avant : l'envoi faisait un `upsert` — un second envoi écrasait la candidature au lieu d'être
 * refusé (candidature sans `devisData`, ou deux envois simultanés). Seule une RÉVISION
 * demandée par le client autorise un nouvel envoi.
 */
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as missionPost } from "@/app/api/missions/route";
import { POST as devisPost } from "@/app/api/missions/[id]/devis/route";
import { POST as proposalPost } from "@/app/api/missions/[id]/proposals/route";
import { POST as requestRevisionPost } from "@/app/api/missions/[id]/proposals/[proposalId]/devis/request-revision/route";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const LONG = 120_000;
const LIGNES = [{ description: "Pose", quantity: 1, unit: "forfait", unitPrice: 80_000 }];

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

async function publier(titre: string, body: Record<string, unknown>) {
  authAs(clientId);
  const res = await missionPost(
    postReq({
      titre: `${titre} ${RUN}`,
      description: "Mission de test : une seule candidature par prestataire.",
      domaine: "batiment",
      mode: "distance",
      currency: "XOF",
      delaiJours: 20,
      status: "publiee",
      ...body,
    }),
  );
  if (![200, 201].includes(res.status)) throw new Error(`publication → ${res.status} ${await res.text()}`);
  const { id } = await res.json();
  missionIds.push(id);
  return id as string;
}

const candidature = (providerId: string, missionId: string, montant = 90_000) => {
  authAs(providerId);
  return proposalPost(postReq({ montant, message: "Je suis disponible." }), at(missionId));
};
const devis = (providerId: string, missionId: string) => {
  authAs(providerId);
  return devisPost(postReq({ lineItems: LIGNES, delay: "20 jours", tvaRate: 0, laborCost: 0, financingModeKey: "F2" }), at(missionId));
};

beforeAll(async () => {
  let n = 0;
  const mk = (key: string, role: string) =>
    prisma.user.create({
      data: { email: `cu-${key}-${RUN}@flexwork.test`, tel: `+229${RUN}${++n}7`, status: "active", country: "BJ", kycStatus: "verifie", role: role as "client" },
    });
  clientId = (await mk("client", "client")).id;
  for (const key of ["deux", "legacy", "course", "devis", "revision"]) presta[key] = (await mk(key, "expert_digital")).id;
}, LONG);

afterAll(async () => {
  const users = [clientId, ...Object.values(presta)];
  await prisma.missionNotification.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}, LONG);

describe("une seule candidature par prestataire et par mission", () => {
  it("second envoi : 409 already_applied, la première candidature est intacte", async () => {
    const missionId = await publier("CU Deux", { budgetType: "FIXED", budget: 100_000 });
    expect((await candidature(presta.deux, missionId, 90_000)).status).toBe(200);
    const res = await candidature(presta.deux, missionId, 50_000);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_applied");
    const rows = await prisma.missionProposal.findMany({ where: { missionId, providerId: presta.deux }, include: { revisions: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ montant: 90_000, roundActuel: 1, status: "envoyee" });
    expect(rows[0].revisions).toHaveLength(1);
  }, LONG);

  it("candidature antérieure aux rounds (sans devisData) : ne peut pas être écrasée", async () => {
    const missionId = await publier("CU Legacy", { budgetType: "FIXED", budget: 100_000 });
    await prisma.missionProposal.create({ data: { missionId, providerId: presta.legacy, montant: 70_000, status: "envoyee", roundActuel: 1 } });
    const res = await candidature(presta.legacy, missionId, 40_000);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_applied");
    expect((await prisma.missionProposal.findFirstOrThrow({ where: { missionId, providerId: presta.legacy } })).montant).toBe(70_000);
  }, LONG);

  it("envois simultanés : une seule candidature, un seul round 1", async () => {
    const missionId = await publier("CU Course", { budgetType: "FIXED", budget: 100_000 });
    authAs(presta.course);
    const results = await Promise.all([1, 2, 3].map((i) => proposalPost(postReq({ montant: 80_000 + i }), at(missionId))));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 200)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(2);
    const rows = await prisma.missionProposal.findMany({ where: { missionId, providerId: presta.course }, include: { revisions: true } });
    expect(rows).toHaveLength(1);
    expect(rows[0].revisions).toHaveLength(1);
  }, LONG);

  it("mode devis : second devis sans demande de révision refusé", async () => {
    const missionId = await publier("CU Devis", { budgetType: "QUOTE" });
    expect((await devis(presta.devis, missionId)).status).toBe(200);
    const res = await devis(presta.devis, missionId);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_applied");
    expect(await prisma.missionProposal.count({ where: { missionId, providerId: presta.devis } })).toBe(1);
  }, LONG);

  it("révision demandée par le client : un seul nouvel envoi, puis de nouveau refusé", async () => {
    const missionId = await publier("CU Revision", { budgetType: "QUOTE" });
    const { proposalId } = await (await devis(presta.revision, missionId)).json();
    authAs(clientId);
    expect((await requestRevisionPost(postReq({ message: "Revoir le prix." }), atProposal(missionId, proposalId))).status).toBe(200);
    expect((await devis(presta.revision, missionId)).status).toBe(200);
    const again = await devis(presta.revision, missionId);
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("already_applied");
    expect((await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalId } })).roundActuel).toBe(2);
  }, LONG);
});
