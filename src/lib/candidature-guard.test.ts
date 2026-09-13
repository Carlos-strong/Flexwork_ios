import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Mission } from "@prisma/client";

const { userFindUnique, garantFindMany, declarationCount, requirementFindFirst } = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  garantFindMany: vi.fn(),
  declarationCount: vi.fn(),
  requirementFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: userFindUnique },
    garant: { findMany: garantFindMany },
    professionalDeclaration: { count: declarationCount },
    // Lu indirectement par isChantierPrestataireAgeOk (src/lib/chantier-age.ts).
    countryAgeRequirement: { findFirst: requirementFindFirst },
  },
}));

import { checkCandidatureEligibility } from "./candidature-guard";

// Prestataire majeur de filière chantier — seuls role/garantRequired varient d'un cas à l'autre.
function provider(overrides: { role?: string; garantRequired?: boolean } = {}) {
  return {
    role: overrides.role ?? "expert_btp_autres",
    dateNaissance: new Date("1990-01-01"),
    country: "BJ",
    garantRequired: overrides.garantRequired ?? false,
  };
}

function mission(overrides: Partial<Mission> = {}): Mission {
  return { status: "publiee", mode: "presentiel", riskLevel: "low", ...overrides } as Mission;
}

beforeEach(() => {
  userFindUnique.mockReset();
  garantFindMany.mockReset();
  declarationCount.mockReset();
  requirementFindFirst.mockReset();
  requirementFindFirst.mockResolvedValue(null); // aucun seuil pays -> plancher légal 18 ans
  declarationCount.mockResolvedValue(1); // assurance déclarée par défaut
  garantFindMany.mockResolvedValue([]);
});

describe("checkCandidatureEligibility — exigence de garant activable par l'Admin KYC (2026-09-09)", () => {
  it("par défaut (garantRequired=false), aucun garant n'est exigé en présentiel — même en filière chantier", async () => {
    userFindUnique.mockResolvedValue(provider({ role: "artisan", garantRequired: false }));

    const result = await checkCandidatureEligibility(mission(), "u1");

    expect(result).toEqual({ ok: true });
    // La règle est court-circuitée AVANT toute lecture des garants.
    expect(garantFindMany).not.toHaveBeenCalled();
  });

  it("l'expert BTP n'est plus bloqué par défaut sur une mission en présentiel", async () => {
    userFindUnique.mockResolvedValue(provider({ role: "expert_btp_autres", garantRequired: false }));

    expect(await checkCandidatureEligibility(mission(), "u1")).toEqual({ ok: true });
  });

  it("une fois l'exigence activée, un compte sans garant obligatoire est bloqué", async () => {
    userFindUnique.mockResolvedValue(provider({ role: "manoeuvre", garantRequired: true }));
    garantFindMany.mockResolvedValue([{ obligatoire: false }]); // 2 optionnelles ne suffisent pas

    const result = await checkCandidatureEligibility(mission(), "u1");

    expect(result).toMatchObject({ ok: false, status: 403, error: "garant_required" });
  });

  it("exigence activée + garant obligatoire déclaré : la candidature passe", async () => {
    userFindUnique.mockResolvedValue(provider({ role: "artisan", garantRequired: true }));
    garantFindMany.mockResolvedValue([{ obligatoire: true }]);

    expect(await checkCandidatureEligibility(mission(), "u1")).toEqual({ ok: true });
  });

  it("mode hybride : l'exigence activée s'applique aussi", async () => {
    userFindUnique.mockResolvedValue(provider({ role: "artisan", garantRequired: true }));

    const result = await checkCandidatureEligibility(mission({ mode: "hybride" }), "u1");

    expect(result).toMatchObject({ ok: false, error: "garant_required" });
  });

  it("mission à distance : jamais de garant, même exigence activée", async () => {
    userFindUnique.mockResolvedValue(provider({ role: "artisan", garantRequired: true }));

    expect(await checkCandidatureEligibility(mission({ mode: "distance" }), "u1")).toEqual({ ok: true });
    expect(garantFindMany).not.toHaveBeenCalled();
  });

  it("hors filière chantier, le drapeau resté à true n'exige rien (garde de rôle)", async () => {
    userFindUnique.mockResolvedValue(provider({ role: "expert_digital", garantRequired: true }));

    expect(await checkCandidatureEligibility(mission(), "u1")).toEqual({ ok: true });
    expect(garantFindMany).not.toHaveBeenCalled();
  });

  it("l'assurance RC Pro reste bloquante sur risque élevé, indépendamment du garant", async () => {
    userFindUnique.mockResolvedValue(provider({ role: "artisan", garantRequired: false }));
    declarationCount.mockResolvedValue(0);

    const result = await checkCandidatureEligibility(mission({ riskLevel: "high" }), "u1");

    expect(result).toMatchObject({ ok: false, status: 403, error: "insurance_required" });
  });

  it("une mission non publiée est refusée avant tout contrôle de garant", async () => {
    userFindUnique.mockResolvedValue(provider({ role: "artisan", garantRequired: true }));

    const result = await checkCandidatureEligibility(mission({ status: "en_cours" }), "u1");

    expect(result).toMatchObject({ ok: false, status: 409, error: "mission_not_open" });
    expect(garantFindMany).not.toHaveBeenCalled();
  });

  it("un mineur de filière chantier est bloqué sur l'âge, avant la question du garant", async () => {
    userFindUnique.mockResolvedValue({ role: "manoeuvre", dateNaissance: new Date("2015-01-01"), country: "BJ", garantRequired: false });

    const result = await checkCandidatureEligibility(mission(), "u1");

    expect(result).toMatchObject({ ok: false, status: 403, error: "age_under_minimum" });
  });
});
