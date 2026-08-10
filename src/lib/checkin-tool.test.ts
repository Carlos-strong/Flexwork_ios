import { describe, expect, it } from "vitest";
import { computeCheckInRetentionDate, isCheckInToolActive } from "./checkin-tool";

describe("isCheckInToolActive (A12 — activation par les deux parties uniquement)", () => {
  it("is inactive if only the client opted in", () => {
    expect(isCheckInToolActive(true, false)).toBe(false);
  });

  it("is inactive if only the provider opted in", () => {
    expect(isCheckInToolActive(false, true)).toBe(false);
  });

  it("is inactive if neither opted in", () => {
    expect(isCheckInToolActive(false, false)).toBe(false);
  });

  it("is active only when both parties opted in", () => {
    expect(isCheckInToolActive(true, true)).toBe(true);
  });
});

describe("computeCheckInRetentionDate", () => {
  it("adds a 7-day contestation delay after the mission deadline", () => {
    const deadline = new Date("2026-08-04T00:00:00Z");
    const retainUntil = computeCheckInRetentionDate(deadline);
    expect(retainUntil.toISOString()).toBe("2026-08-11T00:00:00.000Z");
  });
});
