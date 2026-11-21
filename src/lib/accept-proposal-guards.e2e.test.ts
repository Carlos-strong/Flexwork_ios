/**
 * POST /api/missions/[id]/proposals/[proposalId]/accept — KYC du client et état (2026-11-10).
 *
 * Cas d'origine : un client au KYC « en_attente » recevait un 403 et l'écran affichait
 * « Échec de l'acceptation. » sans raison. Le 403 est voulu (retenir un prestataire exige une
 * identité vérifiée) ; il porte désormais kycStatus + actionUrl. Retenir un prestataire crée
 * son engagement, dans la limite des places recherchées ; l'annonce reste ouverte.
 */
import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { POST as missionPost } from "@/app/api/missions/route";
import { POST as proposalPost } from "@/app/api/missions/[id]/proposals/route";
import { POST as acceptPost } from "@/app/api/missions/[id]/proposals/[proposalId]/accept/route";
import { prisma } from "@/lib/db";

const RUN = Date.now();
const LONG = 120_000;
let clientId = "";
let autreClientId = "";
const presta: string[] = [];
const missionIds: string[] = [];

function authAs(userId: string) {
  mockAuth.mockResolvedValue({ user: { id: userId, email: `${userId}@flexwork.test`, name: "Testeur" } });
}
const postReq = (body: unknown = {}) =>
  new Request("http://localhost/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const at = (id: string) => ({ params: Promise.resolve({ id }) });
const atProposal = (id: string, proposalId: string) => ({ params: Promise.resolve({ id, proposalId }) });

/** Mission publiée par le client + une candidature par prestataire donné. */
async function missionAvecCandidatures(titre: string, providers: string[]) {
  authAs(clientId);
  const res = await missionPost(
    postReq({ titre: `${titre} ${RUN}`, description: "Mission de test : acceptation d'une candidature.", domaine: "batiment", mode: "distance", currency: "XOF", delaiJours: 10, status: "publiee", budgetType: "FIXED", budget: 100_000 }),
  );
  if (![200, 201].includes(res.status)) throw new Error(`publication → ${res.status} ${await res.text()}`);
  const { id: missionId } = await res.json();
  missionIds.push(missionId);
  const proposalIds: string[] = [];
  for (const p of providers) {
    authAs(p);
    const r = await proposalPost(postReq({ montant: 90_000 }), at(missionId));
    if (r.status !== 200) throw new Error(`candidature → ${r.status} ${await r.text()}`);
    proposalIds.push((await r.json()).id);
  }
  return { missionId: missionId as string, proposalIds };
}
const setKyc = (id: string, kycStatus: "en_attente" | "verifie" | "rejete") => prisma.user.update({ where: { id }, data: { kycStatus } });

beforeAll(async () => {
  let n = 0;
  const mk = (key: string, role: string) =>
    prisma.user.create({ data: { email: `ap-${key}-${RUN}@flexwork.test`, tel: `+229${RUN}${++n}8`, status: "active", country: "BJ", kycStatus: "verifie", role: role as "client" } });
  clientId = (await mk("client", "client")).id;
  autreClientId = (await mk("autre", "client")).id;
  for (let i = 0; i < 4; i++) presta.push((await mk(`p${i}`, "expert_digital")).id);
}, LONG);

afterAll(async () => {
  const users = [clientId, autreClientId, ...presta];
  await prisma.missionNotification.deleteMany({ where: { missionId: { in: missionIds } } });
  await prisma.notification.deleteMany({ where: { userId: { in: users } } });
  await prisma.mission.deleteMany({ where: { id: { in: missionIds } } });
  await prisma.user.deleteMany({ where: { id: { in: users } } });
}, LONG);

describe("accept — KYC du client", () => {
  it("KYC en attente : 403 kyc_not_verified avec kycStatus et actionUrl, rien n'est modifié", async () => {
    const { missionId, proposalIds } = await missionAvecCandidatures("AP Kyc", [presta[0]]);
    await setKyc(clientId, "en_attente");
    try {
      authAs(clientId);
      const res = await acceptPost(postReq(), atProposal(missionId, proposalIds[0]));
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: "kyc_not_verified", kycStatus: "en_attente", actionUrl: "/kyc" });
      expect((await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })).status).toBe("publiee");
      expect((await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalIds[0] } })).status).toBe("envoyee");

      await setKyc(clientId, "rejete");
      const rejete = await acceptPost(postReq(), atProposal(missionId, proposalIds[0]));
      expect(rejete.status).toBe(403);
      expect(await rejete.json()).toMatchObject({ error: "kyc_not_verified", kycStatus: "rejete" });
    } finally {
      await setKyc(clientId, "verifie");
    }
    // Une fois vérifié : l'acceptation passe.
    authAs(clientId);
    expect((await acceptPost(postReq(), atProposal(missionId, proposalIds[0]))).status).toBe(200);
  }, LONG);

  it("mission d'un autre client : 404, même avec un KYC non vérifié (pas de 403 qui la révèle)", async () => {
    const { missionId, proposalIds } = await missionAvecCandidatures("AP Autre", [presta[1]]);
    await setKyc(autreClientId, "en_attente");
    authAs(autreClientId);
    expect((await acceptPost(postReq(), atProposal(missionId, proposalIds[0]))).status).toBe(404);
  }, LONG);
});

describe("accept — annonce, places et engagements (2026-11-10)", () => {
  it("1 prestataire recherché : un engagement, l'annonce reste ouverte, l'autre candidature reste en lice", async () => {
    const { missionId, proposalIds } = await missionAvecCandidatures("AP Etat", [presta[2], presta[3]]);
    authAs(clientId);
    const first = await acceptPost(postReq(), atProposal(missionId, proposalIds[0]));
    expect(first.status).toBe(200);
    const { engagementId } = await first.json();
    expect(await prisma.mission.findUniqueOrThrow({ where: { id: engagementId } })).toMatchObject({ parentMissionId: missionId, status: "proposition_acceptee" });
    expect(await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalIds[0] } })).toMatchObject({ missionId: engagementId, status: "acceptee" });
    expect((await prisma.mission.findUniqueOrThrow({ where: { id: missionId } })).status).toBe("publiee");
    // Retenir ne refuse plus les autres : refus à l'échéance seulement.
    expect((await prisma.missionProposal.findUniqueOrThrow({ where: { id: proposalIds[1] } })).status).toBe("envoyee");

    const second = await acceptPost(postReq(), atProposal(missionId, proposalIds[1]));
    expect(second.status).toBe(409);
    expect((await second.json()).error).toBe("places_full");
  }, LONG);

  it("acceptations simultanées sur une seule place : une seule aboutit", async () => {
    const { missionId, proposalIds } = await missionAvecCandidatures("AP Course", [presta[0], presta[1]]);
    authAs(clientId);
    const results = await Promise.all(proposalIds.map((id) => acceptPost(postReq(), atProposal(missionId, id))));
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await prisma.mission.count({ where: { parentMissionId: missionId } })).toBe(1);
  }, LONG);

  it("2 prestataires recherchés : deux engagements distincts, puis places pourvues", async () => {
    const { missionId, proposalIds } = await missionAvecCandidatures("AP Deux", [presta[0], presta[1], presta[2]]);
    await prisma.mission.update({ where: { id: missionId }, data: { maxCandidatures: 2 } });
    authAs(clientId);
    const a = await (await acceptPost(postReq(), atProposal(missionId, proposalIds[0]))).json();
    const b = await (await acceptPost(postReq(), atProposal(missionId, proposalIds[1]))).json();
    expect(a.engagementId).not.toBe(b.engagementId);
    const third = await acceptPost(postReq(), atProposal(missionId, proposalIds[2]));
    expect(third.status).toBe(409);
    expect((await third.json()).error).toBe("places_full");
    // Le prestataire retenu ne peut pas recandidater sur l'annonce.
    authAs(presta[0]);
    const again = await proposalPost(postReq({ montant: 80_000 }), at(missionId));
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("already_applied");
  }, LONG);

  it("annonce échue : plus de sélection possible", async () => {
    const { missionId, proposalIds } = await missionAvecCandidatures("AP Echue", [presta[3]]);
    await prisma.mission.update({ where: { id: missionId }, data: { dateExpiration: new Date(Date.now() - 60_000) } });
    authAs(clientId);
    const res = await acceptPost(postReq(), atProposal(missionId, proposalIds[0]));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("mission_not_open");
  }, LONG);
});
