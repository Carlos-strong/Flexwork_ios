import { describe, expect, it } from "vitest";
import { canStartMission } from "./mission-risk-gate";

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
