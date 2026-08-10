import { describe, expect, it } from "vitest";
import { isGarantPhoneOverused, MAX_PROFILES_PER_GARANT_PHONE } from "./garant-dedup";

describe("isGarantPhoneOverused (US-1311)", () => {
  it("does not flag a phone number used on few profiles", () => {
    expect(isGarantPhoneOverused(1)).toBe(false);
  });

  it("flags a phone number at the threshold", () => {
    expect(isGarantPhoneOverused(MAX_PROFILES_PER_GARANT_PHONE)).toBe(true);
  });
});
