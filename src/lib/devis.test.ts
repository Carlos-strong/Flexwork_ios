import { describe, expect, it } from "vitest";
import { computeDevisData } from "./devis";
import { devisSchema } from "./validation";

describe("computeDevisData", () => {
  it("calcule HT, TVA (20%) et TTC", () => {
    const devis = computeDevisData(
      [{ description: "Pose carrelage", quantity: 2, unit: "m2", unitPrice: 100 }],
      "3 semaines",
      "",
      20
    );
    expect(devis.lineItems[0].total).toBe(200);
    expect(devis.totalHT).toBe(200);
    expect(devis.tva).toBe(40);
    expect(devis.totalTTC).toBe(240);
    expect(devis.tvaRate).toBe(20);
  });

  it("applique une TVA nulle", () => {
    const devis = computeDevisData(
      [{ description: "Forfait", quantity: 1, unit: "forfait", unitPrice: 1000 }],
      "5 jours",
      "",
      0
    );
    expect(devis.tva).toBe(0);
    expect(devis.totalTTC).toBe(1000);
  });

  it("additionne plusieurs postes", () => {
    const devis = computeDevisData(
      [
        { description: "A", quantity: 2, unit: "u", unitPrice: 50 },
        { description: "B", quantity: 3, unit: "h", unitPrice: 10 },
      ],
      "1 semaine",
      "",
      20
    );
    expect(devis.totalHT).toBe(130);
    expect(devis.tva).toBe(26);
    expect(devis.totalTTC).toBe(156);
  });

  it("arrondit proprement les montants décimaux", () => {
    const devis = computeDevisData(
      [{ description: "A", quantity: 3, unit: "u", unitPrice: 0.1 }],
      "1 semaine",
      "",
      20
    );
    expect(devis.lineItems[0].total).toBe(0.3);
    expect(devis.totalHT).toBe(0.3);
    expect(devis.tva).toBe(0.06);
    expect(devis.totalTTC).toBe(0.36);
  });
});

describe("devisSchema", () => {
  const valid = {
    lineItems: [{ description: "A", quantity: 1, unit: "forfait", unitPrice: 100 }],
    delay: "3 semaines",
  };

  it("accepte un devis valide", () => {
    expect(devisSchema.safeParse(valid).success).toBe(true);
  });

  it("refuse une liste de postes vide", () => {
    expect(devisSchema.safeParse({ lineItems: [], delay: "3 semaines" }).success).toBe(false);
  });

  it("refuse une quantité non positive", () => {
    expect(
      devisSchema.safeParse({
        lineItems: [{ description: "A", quantity: 0, unit: "u", unitPrice: 10 }],
        delay: "3 semaines",
      }).success
    ).toBe(false);
  });

  it("refuse un délai manquant", () => {
    expect(devisSchema.safeParse({ lineItems: valid.lineItems }).success).toBe(false);
  });
});
