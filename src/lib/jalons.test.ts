import { describe, expect, it } from "vitest";
import { validateJalonsSum, canSubmitJalonDeliverable, canHoldJalon, canDecideJalon } from "./jalons";

describe("validateJalonsSum", () => {
  it("refuses an empty list", () => {
    expect(validateJalonsSum([], 100000)).toEqual({ ok: false, error: "jalons_empty" });
  });

  it("refuses a non-positive montant", () => {
    expect(validateJalonsSum([{ titre: "A", montant: 0 }], 0)).toEqual({ ok: false, error: "jalon_montant_invalide" });
  });

  it("refuses an empty titre", () => {
    expect(validateJalonsSum([{ titre: "  ", montant: 100 }], 100)).toEqual({ ok: false, error: "jalon_titre_requis" });
  });

  it("refuses a sum that does not match the contract price", () => {
    expect(
      validateJalonsSum([{ titre: "A", montant: 50000 }, { titre: "B", montant: 40000 }], 100000)
    ).toEqual({ ok: false, error: "jalons_sum_mismatch" });
  });

  it("accepts a sum matching exactly", () => {
    expect(
      validateJalonsSum([{ titre: "A", montant: 60000 }, { titre: "B", montant: 40000 }], 100000)
    ).toEqual({ ok: true });
  });

  it("tolerates floating point rounding", () => {
    expect(
      validateJalonsSum([{ titre: "A", montant: 33333.33 }, { titre: "B", montant: 33333.33 }, { titre: "C", montant: 33333.34 }], 100000)
    ).toEqual({ ok: true });
  });
});

describe("jalon status guards", () => {
  it("canHoldJalon only allows en_attente", () => {
    expect(canHoldJalon("en_attente")).toBe(true);
    expect(canHoldJalon("fonds_sous_sequestre")).toBe(false);
  });

  it("canSubmitJalonDeliverable allows fonds_sous_sequestre and rejete", () => {
    expect(canSubmitJalonDeliverable("fonds_sous_sequestre")).toBe(true);
    expect(canSubmitJalonDeliverable("rejete")).toBe(true);
    expect(canSubmitJalonDeliverable("en_attente")).toBe(false);
    expect(canSubmitJalonDeliverable("libere")).toBe(false);
  });

  it("canDecideJalon only allows livrable_soumis", () => {
    expect(canDecideJalon("livrable_soumis")).toBe(true);
    expect(canDecideJalon("valide")).toBe(false);
  });
});
