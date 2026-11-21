import { describe, expect, it } from "vitest";
import { assertNoSelfDealing, assertPartyExclusive } from "./invariants";

describe("assertNoSelfDealing", () => {
  it("refuse le contrat d'une personne avec elle-même", () => {
    const userId = "u1";
    expect(assertNoSelfDealing(userId, userId)).toBe(false);
  });

  it("accepte deux parties distinctes", () => {
    expect(assertNoSelfDealing("u1", "u2")).toBe(true);
  });

  it("est symétrique (client/prestataire)", () => {
    expect(assertNoSelfDealing("u2", "u1")).toBe(true);
  });
});

describe("assertPartyExclusive", () => {
  it("accepte un client seul", () => {
    expect(assertPartyExclusive(true, false)).toBe(true);
  });

  it("accepte un prestataire seul", () => {
    expect(assertPartyExclusive(false, true)).toBe(true);
  });

  it("refuse quand les deux faces sont vraies (donnée invalide en base)", () => {
    expect(assertPartyExclusive(true, true)).toBe(false);
  });

  it("accepte un tiers sans lien", () => {
    expect(assertPartyExclusive(false, false)).toBe(true);
  });
});
