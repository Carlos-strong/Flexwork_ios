import { describe, expect, it, vi, beforeEach } from "vitest";

const { categorieFindUnique, requirementFindFirst } = vi.hoisted(() => ({
  categorieFindUnique: vi.fn(),
  requirementFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    categorie: { findUnique: categorieFindUnique },
    countryAgeRequirement: { findFirst: requirementFindFirst },
  },
}));

import { isCategorieAgeOk } from "./age-categorie";

beforeEach(() => {
  categorieFindUnique.mockReset();
  requirementFindFirst.mockReset();
});

// A13 — la barrière d'âge est portée par la CATÉGORIE du métier (2026-09-24), plus par la
// filière du compte. Ces tests fixent la conséquence la plus importante de ce déplacement :
// c'est le travail qui déclenche le contrôle, pas la façon dont on se déclare.
describe("isCategorieAgeOk — A13 par catégorie de métier", () => {
  it("ne contrôle rien sans métier choisi (catégorie inconnue)", async () => {
    const result = await isCategorieAgeOk({
      categorieId: null,
      role: "artisan",
      country: "BJ",
      dateNaissance: null, // même sans date : il n'y a rien à classer
    });
    expect(result).toEqual({ ok: true });
    expect(categorieFindUnique).not.toHaveBeenCalled();
    expect(requirementFindFirst).not.toHaveBeenCalled();
  });

  it("ne contrôle rien sur une catégorie NON marquée par l'admin — quelle que soit la filière", async () => {
    categorieFindUnique.mockResolvedValue({ requiresAgeCheck: false });
    const result = await isCategorieAgeOk({
      categorieId: "cat-design",
      role: "manoeuvre", // filière auparavant contrôlée : elle ne l'est plus
      country: "BJ",
      dateNaissance: new Date("2012-01-01"), // mineur
    });
    expect(result).toEqual({ ok: true });
    expect(requirementFindFirst).not.toHaveBeenCalled();
  });

  it("contrôle une catégorie marquée même pour une filière « hors chantier » (l'électricien déclaré « Prestataire indépendant »)", async () => {
    categorieFindUnique.mockResolvedValue({ requiresAgeCheck: true });
    requirementFindFirst.mockResolvedValue(null); // plancher légal
    const result = await isCategorieAgeOk({
      categorieId: "cat-btp",
      role: "expert_digital", // filière que l'ancienne règle exemptait
      country: "BJ",
      dateNaissance: new Date("2010-05-01"), // 16 ans
    });
    expect(result).toEqual({ ok: false, reason: "under_minimum_age" });
  });

  it("catégorie marquée + date absente = âge NON ÉTABLI, pas âge insuffisant", async () => {
    categorieFindUnique.mockResolvedValue({ requiresAgeCheck: true });
    requirementFindFirst.mockResolvedValue(null);
    const result = await isCategorieAgeOk({
      categorieId: "cat-btp",
      role: "artisan",
      country: "BJ",
      dateNaissance: null,
    });
    // Les deux refus ne se réparent pas pareil : dossier d'identité à faire, ou anniversaire à
    // attendre. Les confondre était le défaut corrigé le 2026-09-24.
    expect(result).toEqual({ ok: false, reason: "no_birth_date" });
  });

  it("catégorie inexistante en base : aucun contrôle (la FK garantit le cas, on ne bloque pas sur une donnée manquante)", async () => {
    categorieFindUnique.mockResolvedValue(null);
    const result = await isCategorieAgeOk({
      categorieId: "cat-supprimee",
      role: "artisan",
      country: "BJ",
      dateNaissance: null,
    });
    expect(result).toEqual({ ok: true });
    expect(requirementFindFirst).not.toHaveBeenCalled();
  });

  it("applique le plancher légal 18 ans par défaut sur une catégorie marquée", async () => {
    categorieFindUnique.mockResolvedValue({ requiresAgeCheck: true });
    requirementFindFirst.mockResolvedValue(null); // aucune règle pays -> 18
    const minor = await isCategorieAgeOk({
      categorieId: "cat-btp",
      role: "manoeuvre",
      country: "BJ",
      dateNaissance: new Date("2010-05-01"),
    });
    expect(minor).toEqual({ ok: false, reason: "under_minimum_age" });

    const adult = await isCategorieAgeOk({
      categorieId: "cat-btp",
      role: "manoeuvre",
      country: "BJ",
      dateNaissance: new Date("2000-05-01"),
    });
    expect(adult).toEqual({ ok: true });
  });

  it("applique un seuil administré par pays (>18) quand il existe", async () => {
    categorieFindUnique.mockResolvedValue({ requiresAgeCheck: true });
    requirementFindFirst.mockResolvedValue({ minimumAge: 21 });
    const nineteen = await isCategorieAgeOk({
      categorieId: "cat-btp",
      role: "expert_btp_autres",
      country: "BJ",
      dateNaissance: new Date("2006-01-01"),
    });
    expect(nineteen).toEqual({ ok: false, reason: "under_minimum_age" });

    const twentyTwo = await isCategorieAgeOk({
      categorieId: "cat-btp",
      role: "expert_btp_autres",
      country: "BJ",
      dateNaissance: new Date("2003-01-01"),
    });
    expect(twentyTwo).toEqual({ ok: true });
  });

  it("lit le seuil avec la clé (pays, filière, domaine général) — la filière reste la maille du seuil, pas de l'applicabilité", async () => {
    categorieFindUnique.mockResolvedValue({ requiresAgeCheck: true });
    requirementFindFirst.mockResolvedValue({ minimumAge: 18 });
    await isCategorieAgeOk({
      categorieId: "cat-btp",
      role: "artisan",
      country: "SN",
      dateNaissance: new Date("2000-01-01"),
    });
    const where = requirementFindFirst.mock.calls[0][0].where;
    expect(where).toEqual({ country: "SN", profileType: "artisan", domain: null });
  });
});
