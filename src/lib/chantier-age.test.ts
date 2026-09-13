import { describe, expect, it, vi, beforeEach } from "vitest";

const { requirementFindFirst } = vi.hoisted(() => ({
  requirementFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    countryAgeRequirement: { findFirst: requirementFindFirst },
  },
}));

import { isChantierPrestataireAgeOk } from "./chantier-age";

beforeEach(() => {
  requirementFindFirst.mockReset();
});

describe("isChantierPrestataireAgeOk — A13 par filière prestataire", () => {
  it("le côté client n'est jamais soumis au contrôle (rôle non-chantier)", async () => {
    const result = await isChantierPrestataireAgeOk({
      role: "client",
      country: "BJ",
      dateNaissance: new Date("2015-01-01"), // même un mineur côté client : OK
    });
    expect(result).toEqual({ ok: true });
    expect(requirementFindFirst).not.toHaveBeenCalled();
  });

  it("un expert digital (non-chantier) n'est jamais soumis", async () => {
    const result = await isChantierPrestataireAgeOk({
      role: "expert_digital",
      country: "BJ",
      dateNaissance: new Date("2010-01-01"),
    });
    expect(result).toEqual({ ok: true });
  });

  it("sans date de naissance (KYC non validé), une filière chantier est bloquée", async () => {
    requirementFindFirst.mockResolvedValue(null);
    const result = await isChantierPrestataireAgeOk({
      role: "artisan",
      country: "BJ",
      dateNaissance: null,
    });
    expect(result).toEqual({ ok: false, reason: "no_birth_date" });
  });

  it("applique le plancher légal 18 ans par défaut", async () => {
    requirementFindFirst.mockResolvedValue(null); // aucune règle pays -> 18
    const minor = await isChantierPrestataireAgeOk({
      role: "manoeuvre",
      country: "BJ",
      dateNaissance: new Date("2010-05-01"),
    });
    expect(minor).toEqual({ ok: false, reason: "under_minimum_age" });

    const adult = await isChantierPrestataireAgeOk({
      role: "manoeuvre",
      country: "BJ",
      dateNaissance: new Date("2000-05-01"),
    });
    expect(adult).toEqual({ ok: true });
  });

  it("applique un seuil administré par pays (>18) quand il existe", async () => {
    requirementFindFirst.mockResolvedValue({ minimumAge: 21 });
    const eighteen = await isChantierPrestataireAgeOk({
      role: "expert_btp_autres",
      country: "BJ",
      dateNaissance: new Date("2006-01-01"),
    });
    expect(eighteen).toEqual({ ok: false, reason: "under_minimum_age" });

    const twentyTwo = await isChantierPrestataireAgeOk({
      role: "expert_btp_autres",
      country: "BJ",
      dateNaissance: new Date("2003-01-01"),
    });
    expect(twentyTwo).toEqual({ ok: true });
  });

  it("interroge countryAgeRequirement avec la bonne clé (pays, filière, domaine général)", async () => {
    requirementFindFirst.mockResolvedValue({ minimumAge: 18 });
    await isChantierPrestataireAgeOk({ role: "artisan", country: "SN", dateNaissance: new Date("2000-01-01") });
    const where = requirementFindFirst.mock.calls[0][0].where;
    expect(where).toEqual({ country: "SN", profileType: "artisan", domain: null });
  });
});
