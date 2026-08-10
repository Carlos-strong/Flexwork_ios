import { describe, expect, it } from "vitest";
import { hasRequiredGarants, canAddGarant, GARANTS_MAX } from "./garant-rules";

describe("hasRequiredGarants (etat-consolide-Flexwork.md §1.3 : 1 obligatoire + 2 optionnelles)", () => {
  it("is not satisfied with zero garants", () => {
    expect(hasRequiredGarants([])).toBe(false);
  });

  it("is not satisfied with only optional garants", () => {
    expect(hasRequiredGarants([{ obligatoire: false }, { obligatoire: false }])).toBe(false);
  });

  it("is satisfied with exactly one mandatory garant", () => {
    expect(hasRequiredGarants([{ obligatoire: true }])).toBe(true);
  });

  it("is satisfied with the mandatory garant plus optional ones", () => {
    expect(hasRequiredGarants([{ obligatoire: true }, { obligatoire: false }])).toBe(true);
  });
});

describe("canAddGarant", () => {
  it("allows adding up to the max of 3", () => {
    expect(canAddGarant(0)).toBe(true);
    expect(canAddGarant(GARANTS_MAX - 1)).toBe(true);
  });

  it("refuses beyond the max", () => {
    expect(canAddGarant(GARANTS_MAX)).toBe(false);
  });
});
