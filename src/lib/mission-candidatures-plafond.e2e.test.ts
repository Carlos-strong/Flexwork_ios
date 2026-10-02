/**
 * Plafond de candidatures (2026-09-23) — `Mission.maxCandidatures`.
 *
 * Le plafond était jusqu'ici saisi, stocké, et jamais appliqué : l'écran de confirmation
 * promettait « vous recevrez jusqu'à 5 devis » sans qu'aucun mécanisme ne le tienne.
 *
 * Il vit dans `checkCandidatureEligibility`, garde PARTAGÉE par les deux voies de candidature
 * (proposition à prix et devis en mode QUOTE) : le poser dans une seule route reviendrait à
 * laisser l'autre porte ouverte. Ces tests vérifient le comptage, ce qui libère une place, et
 * le cas du prestataire déjà en lice.
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

type ListedMission = { id: string; candidaturesCount: number; candidaturesClosed: boolean };

async function listOpenMissions(): Promise<ListedMission[]> {
  const res = await listMissions();
  return (await res.json()).items;
}

const RUN = Date.now();
let clientId = "";
const providerIds: string[] = [];
let missionId = "";

async function makeMission(maxCandidatures: number | null) {
  const mission = await prisma.mission.create({
    data: {
      clientId,
      titre: "Mission plafond",
      description: "Description suffisamment longue pour la validation.",
      domaine: "Plomberie",
      mode: "distance", // évite garants et assurance : on teste le plafond, rien d'autre
      budget: 100000,
      delaiJours: 5,
      status: "publiee",
      maxCandidatures,
    },
  });
  missionId = mission.id;
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

describe("plafond appliqué", () => {
  it("laisse candidater tant que le plafond n'est pas atteint", async () => {
    const mission = await makeMission(2);
    await apply(mission.id, providerIds[0], "envoyee");
    expect(await checkCandidatureEligibility(mission, providerIds[1])).toEqual({ ok: true });
  });

  it("refuse une fois le plafond atteint, avec un message qui l'explique", async () => {
    const mission = await makeMission(2);
    await apply(mission.id, providerIds[0], "envoyee");
    await apply(mission.id, providerIds[1], "envoyee");

    const result = await checkCandidatureEligibility(mission, providerIds[2]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(409);
    expect(result.error).toBe("candidatures_closed");
    expect(result.message).toContain("2");
  });

  it("n'applique aucun plafond quand la mission n'en fixe pas", async () => {
    const mission = await makeMission(null);
    for (const id of providerIds.slice(0, 3)) await apply(mission.id, id, "envoyee");
    expect(await checkCandidatureEligibility(mission, providerIds[3])).toEqual({ ok: true });
  });
});

describe("ce qui libère une place", () => {
  it("ne compte pas une candidature refusée — elle a libéré sa place", async () => {
    const mission = await makeMission(2);
    await apply(mission.id, providerIds[0], "envoyee");
    await apply(mission.id, providerIds[1], "refusee");
    expect(await checkCandidatureEligibility(mission, providerIds[2])).toEqual({ ok: true });
  });

  it("ne compte pas une négociation définitivement annulée", async () => {
    const mission = await makeMission(2);
    await apply(mission.id, providerIds[0], "envoyee");
    await apply(mission.id, providerIds[1], "annulee_definitive");
    expect(await checkCandidatureEligibility(mission, providerIds[2])).toEqual({ ok: true });
  });

  it("compte en revanche une candidature acceptée", async () => {
    const mission = await makeMission(1);
    await apply(mission.id, providerIds[0], "acceptee");
    const result = await checkCandidatureEligibility(mission, providerIds[1]);
    expect(result.ok).toBe(false);
  });
});

describe("le prestataire déjà en lice", () => {
  it("n'est pas bloqué par le plafond qu'il occupe lui-même", async () => {
    const mission = await makeMission(1);
    await apply(mission.id, providerIds[0], "envoyee");
    // Il est dedans : il ne cherche pas à entrer. Le bloquer l'empêcherait de réviser.
    expect(await checkCandidatureEligibility(mission, providerIds[0])).toEqual({ ok: true });
  });
});

describe("visibilité du plafond dans la liste des missions", () => {
  it("annonce la fermeture au prestataire AVANT qu'il rédige sa proposition", async () => {
    const mission = await makeMission(1);
    await apply(mission.id, providerIds[0], "envoyee");

    as(providerIds[1]);
    const items = await listOpenMissions();
    const item = items.find((m) => m.id === mission.id)!;
    expect(item.candidaturesCount).toBe(1);
    expect(item.candidaturesClosed).toBe(true);
  });

  it("ne la déclare pas fermée pour celui qui occupe déjà une place", async () => {
    const mission = await makeMission(1);
    await apply(mission.id, providerIds[0], "envoyee");

    as(providerIds[0]);
    const item = (await listOpenMissions()).find((m) => m.id === mission.id)!;
    expect(item.candidaturesClosed).toBe(false);
  });

  it("laisse ouverte une mission sans plafond, quel que soit le nombre de candidats", async () => {
    const mission = await makeMission(null);
    for (const id of providerIds.slice(0, 3)) await apply(mission.id, id, "envoyee");

    as(providerIds[3]);
    const item = (await listOpenMissions()).find((m) => m.id === mission.id)!;
    expect(item.candidaturesClosed).toBe(false);
    expect(item.candidaturesCount).toBe(3);
  });

  it("ne compte pas les candidatures refusées dans le total affiché", async () => {
    const mission = await makeMission(3);
    await apply(mission.id, providerIds[0], "envoyee");
    await apply(mission.id, providerIds[1], "refusee");

    as(providerIds[2]);
    const item = (await listOpenMissions()).find((m) => m.id === mission.id)!;
    expect(item.candidaturesCount).toBe(1);
    expect(item.candidaturesClosed).toBe(false);
  });
});
