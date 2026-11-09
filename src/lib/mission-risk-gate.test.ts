import { describe, expect, it } from "vitest";
import { canStartMission, coversAmount } from "./mission-risk-gate";

describe("canStartMission (US-702 — exception risque élevé, sans fenêtre de tolérance)", () => {
  it("never blocks a low-risk mission, covered or not", () => {
    expect(canStartMission("low", false)).toBe(true);
    expect(canStartMission("low", true)).toBe(true);
  });

  it("never blocks a medium-risk mission (declarative only)", () => {
    expect(canStartMission("medium", false)).toBe(true);
  });

  it("blocks a high-risk mission without effective coverage", () => {
    expect(canStartMission("high", false)).toBe(false);
  });

  it("allows a high-risk mission with effective coverage", () => {
    expect(canStartMission("high", true)).toBe(true);
  });
});

describe("coversAmount — le plafond doit couvrir l'exposition réelle", () => {
  it("refuse une police dont le plafond est inférieur au montant séquestré", () => {
    // Le défaut corrigé : `canStartMission` ne regardait que l'EXISTENCE d'une couverture
    // active, si bien qu'une police à 100 000 « couvrait » une mission à 5 000 000 — sur
    // exactement les missions (risque élevé) que la garantie est censée protéger.
    expect(coversAmount(100000, 5000000)).toBe(false);
  });

  it("accepte un plafond égal ou supérieur", () => {
    expect(coversAmount(5000000, 5000000)).toBe(true);
    expect(coversAmount(6000000, 5000000)).toBe(true);
  });
});
