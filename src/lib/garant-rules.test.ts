import { describe, expect, it } from "vitest";
import { hasRequiredGarants, canAddGarant, isDuplicateGarantTel, normalizeTel, GARANTS_MAX } from "./garant-rules";

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

describe("normalizeTel", () => {
  it("retire les espaces sans toucher au reste", () => {
    expect(normalizeTel("+229 96 12 34 56")).toBe("+22996123456");
  });

  it("laisse un numéro déjà compact inchangé", () => {
    expect(normalizeTel("+22996123456")).toBe("+22996123456");
  });
});

describe("isDuplicateGarantTel (un même garant ne doit pas être utilisé deux fois pour le même candidat)", () => {
  const existing = [
    { id: "g1", tel: "+229 96 12 34 56" },
    { id: "g2", tel: "+22997000000" },
  ];

  it("détecte un doublon exact", () => {
    expect(isDuplicateGarantTel("+22997000000", existing)).toBe(true);
  });

  it("détecte un doublon malgré une mise en forme différente (espaces)", () => {
    expect(isDuplicateGarantTel("+229 97 00 00 00", existing)).toBe(true);
  });

  it("n'est pas un doublon pour un numéro réellement différent", () => {
    expect(isDuplicateGarantTel("+22998111111", existing)).toBe(false);
  });

  it("exclut le garant lui-même lors d'une modification (excludeId)", () => {
    expect(isDuplicateGarantTel("+229 96 12 34 56", existing, "g1")).toBe(false);
  });

  it("reste un doublon si on essaie de prendre le numéro d'UN AUTRE garant lors d'une modification", () => {
    expect(isDuplicateGarantTel("+22997000000", existing, "g1")).toBe(true);
  });
});
