import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock de la couche DB AVANT l'import du module testé : le garde ne doit dépendre que de
// findFirst (condition de propriété dans le where, règle R01) — jamais d'un findUnique suivi
// d'un `if` après coup. `vi.hoisted` est requis : la factory de `vi.mock` est remontée en
// tête de fichier, les fns doivent donc être créées avant.
const { missionFindFirst, contractFindFirst } = vi.hoisted(() => ({
  missionFindFirst: vi.fn(),
  contractFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    mission: { findFirst: missionFindFirst },
    prestationContract: { findFirst: contractFindFirst },
  },
}));

import { requireMissionParty, requireContractParty } from "./resource-guard";

const mission = (overrides: Partial<{ clientId: string; proposals: { providerId: string }[] }> = {}) => ({
  id: "m1",
  clientId: "client-1",
  proposals: [] as { providerId: string }[],
  titre: "Mission test",
  ...overrides,
});

beforeEach(() => {
  missionFindFirst.mockReset();
  contractFindFirst.mockReset();
});

describe("requireMissionParty", () => {
  it("retourne 404 quand la mission n'existe pas pour cet utilisateur (indistinguable)", async () => {
    missionFindFirst.mockResolvedValue(null);
    const result = await requireMissionParty("m1", "tiers");
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it("insère la condition de propriété DANS le where (règle R01)", async () => {
    missionFindFirst.mockResolvedValue(mission({ clientId: "client-1" }));
    await requireMissionParty("m1", "client-1");
    const where = missionFindFirst.mock.calls[0][0].where;
    expect(where.id).toBe("m1");
    expect(where.OR).toEqual([
      { clientId: "client-1" },
      { proposals: { some: { providerId: "client-1" } } },
    ]);
  });

  it("qualifie le client propriétaire (isClient, pas isProvider)", async () => {
    missionFindFirst.mockResolvedValue(mission({ clientId: "client-1" }));
    const result = await requireMissionParty("m1", "client-1");
    expect(result).toMatchObject({ ok: true, isClient: true, isProvider: false });
  });

  it("qualifie un prestataire candidat (isProvider, pas isClient)", async () => {
    missionFindFirst.mockResolvedValue(
      mission({ clientId: "client-1", proposals: [{ providerId: "candidat-9" }] })
    );
    const result = await requireMissionParty("m1", "candidat-9");
    expect(result).toMatchObject({ ok: true, isClient: false, isProvider: true });
  });

  it("qualifie les deux faces si les deux branches sont vraies (dual-role) — sans déduire l'une de l'autre", async () => {
    missionFindFirst.mockResolvedValue(
      mission({ clientId: "u1", proposals: [{ providerId: "u1" }] })
    );
    const result = await requireMissionParty("m1", "u1");
    expect(result).toMatchObject({ ok: true, isClient: true, isProvider: true });
  });
});

describe("requireContractParty", () => {
  it("retourne 404 pour un tiers", async () => {
    contractFindFirst.mockResolvedValue(null);
    const result = await requireContractParty("c1", "tiers");
    expect(result).toEqual({ ok: false, status: 404 });
  });

  it("accepte le client du contrat", async () => {
    contractFindFirst.mockResolvedValue({ id: "c1", clientId: "client-1", providerId: "prov-1" });
    const result = await requireContractParty("c1", "client-1");
    expect(result).toMatchObject({ ok: true });
  });

  it("accepte le prestataire du contrat", async () => {
    contractFindFirst.mockResolvedValue({ id: "c1", clientId: "client-1", providerId: "prov-1" });
    const result = await requireContractParty("c1", "prov-1");
    expect(result).toMatchObject({ ok: true });
  });

  it("met la condition de propriété dans le where", async () => {
    contractFindFirst.mockResolvedValue({ id: "c1", clientId: "client-1", providerId: "prov-1" });
    await requireContractParty("c1", "client-1");
    const where = contractFindFirst.mock.calls[0][0].where;
    expect(where.id).toBe("c1");
    expect(where.OR).toEqual([{ clientId: "client-1" }, { providerId: "client-1" }]);
  });
});
