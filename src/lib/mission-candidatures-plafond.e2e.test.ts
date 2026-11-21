/**
 * Annonce : période de candidature et prestataires recherchés (2026-11-10).
 *
 * `Mission.maxCandidatures` n'est plus un plafond de candidatures (2026-09-23 → 2026-11-10) :
 * c'est le nombre de prestataires que le client RETIENDRA. Seule la date limite de candidature
 * ferme l'annonce. Ces tests vérifient la garde partagée (`checkCandidatureEligibility`) et ce
 * que la liste des missions dit au prestataire.
 */

import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";

const mockAuth = vi.fn();
vi.mock("@/auth", () => ({ auth: () => mockAuth() }));

import { prisma } from "@/lib/db";
import { checkCandidatureEligibility } from "@/lib/candidature-guard";
import { GET as listMissions } from "@/app/api/missions/route";

const as = (userId: string | null) => {
  mockAuth.mockResolvedValue(userId ? { user: { id: userId } } : null);
};

type ListedMission = {
  id: string;
  candidaturesCount: number;
  placesRecherchees: number;
  prestatairesRetenus: number;
  placesRestantes: number;
  dejaCandidat: boolean;
};

async function listOpenMissions(): Promise<ListedMission[]> {
  const res = await listMissions();
  return (await res.json()).items;
}

const RUN = Date.now();
let clientId = "";
const providerIds: string[] = [];

async function makeMission(maxCandidatures: number | null, dateExpiration: Date | null = null) {
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: "Mission annonce",
      description: "Description suffisamment longue pour la validation.",
      domaine: "Plomberie",
      mode: "distance", // évite garants et assurance : on teste le plafond, rien d'autre
      budget: 100000,
      delaiJours: 5,
      status: "publiee",
      maxCandidatures,
      dateExpiration,
    },
  });
  return mission;
}

const apply = (missionId: string, providerId: string, status: "envoyee" | "refusee" | "annulee_definitive" | "acceptee") =>
  prisma.missionProposal.create({ data: { missionId, providerId, montant: 100000, status } });

beforeAll(async () => {
  const client = await prisma.user.create({
    data: { email: `e2e-plafond-c-${RUN}@flexwork.test`, tel: `+2296${String(RUN).slice(-7)}`, role: "client", country: "BJ" },
  });
  clientId = client.id;
  for (let i = 0; i < 4; i += 1) {
    const p = await prisma.user.create({
      data: {
        email: `e2e-plafond-p${i}-${RUN}@flexwork.test`,
        tel: `+2295${String(RUN).slice(-6)}${i}`,
        role: "expert_digital",
        country: "BJ",
        dateNaissance: new Date("1990-01-01"),
      },
    });
    providerIds.push(p.id);
  }
});

afterAll(async () => {
  await prisma.missionProposal.deleteMany({ where: { mission: { clientId } } });
  await prisma.mission.deleteMany({ where: { clientId } });
  await prisma.user.deleteMany({ where: { id: { in: [clientId, ...providerIds] } } });
});

describe("le nombre de prestataires recherchés ne limite plus les candidatures", () => {
  it("laisse candidater au-delà du nombre recherché", async () => {
    const mission = await makeMission(1);
    await apply(mission.id, providerIds[0], "envoyee");
    await apply(mission.id, providerIds[1], "envoyee");
    expect(await checkCandidatureEligibility(mission, providerIds[2])).toEqual({ ok: true });
  });

  it("laisse candidater même une fois les places pourvues — seule la date ferme l'annonce", async () => {
    const mission = await makeMission(1);
    const engagement = await prisma.mission.create({
      data: { clientId, titre: "Engagement", description: "x", domaine: "Plomberie", mode: "distance", budget: 1, delaiJours: 5, status: "proposition_acceptee", parentMissionId: mission.id },
    });
    await apply(engagement.id, providerIds[0], "acceptee");
    expect(await checkCandidatureEligibility(mission, providerIds[1])).toEqual({ ok: true });
    // …mais pas le prestataire déjà retenu.
    expect(await checkCandidatureEligibility(mission, providerIds[0])).toMatchObject({ ok: false, error: "already_applied" });
  });
});

describe("la date limite de candidature", () => {
  it("ferme l'annonce une fois passée", async () => {
    const mission = await makeMission(null, new Date(Date.now() - 60_000));
    expect(await checkCandidatureEligibility(mission, providerIds[0])).toMatchObject({ ok: false, status: 409, error: "mission_expired" });
  });

  it("laisse candidater tant qu'elle n'est pas atteinte", async () => {
    const mission = await makeMission(null, new Date(Date.now() + 86_400_000));
    expect(await checkCandidatureEligibility(mission, providerIds[0])).toEqual({ ok: true });
  });
});

describe("ce que la liste des missions dit au prestataire", () => {
  it("annonce les places recherchées et les prestataires déjà retenus", async () => {
    const mission = await makeMission(3);
    await prisma.mission.create({
      data: { clientId, titre: "Engagement", description: "x", domaine: "Plomberie", mode: "distance", budget: 1, delaiJours: 5, status: "proposition_acceptee", parentMissionId: mission.id },
    });
    as(providerIds[1]);
    const item = (await listOpenMissions()).find((m) => m.id === mission.id)!;
    expect(item).toMatchObject({ placesRecherchees: 3, prestatairesRetenus: 1, placesRestantes: 2 });
  });

  it("n'affiche plus une annonce échue", async () => {
    const mission = await makeMission(null, new Date(Date.now() - 60_000));
    as(providerIds[1]);
    expect((await listOpenMissions()).find((m) => m.id === mission.id)).toBeUndefined();
  });

  it("ne compte pas les candidatures refusées dans le total affiché", async () => {
    const mission = await makeMission(3);
    await apply(mission.id, providerIds[0], "envoyee");
    await apply(mission.id, providerIds[1], "refusee");
    as(providerIds[2]);
    const item = (await listOpenMissions()).find((m) => m.id === mission.id)!;
    expect(item.candidaturesCount).toBe(1);
    expect(item.dejaCandidat).toBe(false);
  });
});
