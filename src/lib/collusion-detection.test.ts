import { describe, expect, it } from "vitest";
import { isRoundAmount, detectCollusionSuspicion } from "./collusion-detection";

describe("isRoundAmount (US-1312)", () => {
  it("flags round thousands", () => {
    expect(isRoundAmount(50000)).toBe(true);
  });

  it("does not flag non-round amounts", () => {
    expect(isRoundAmount(49999)).toBe(false);
  });
});

describe("detectCollusionSuspicion (US-1312)", () => {
  it("flags repeated round-amount transactions sharing the same device fingerprint", () => {
    const transactions = Array.from({ length: 3 }, () => ({
      montant: 50000,
      payerDeviceFingerprint: "device-abc",
      payeeDeviceFingerprint: "device-abc",
    }));
    expect(detectCollusionSuspicion(transactions)).toBe(true);
  });

  it("does not flag transactions from genuinely different devices", () => {
    const transactions = [
      { montant: 50000, payerDeviceFingerprint: "device-a", payeeDeviceFingerprint: "device-b" },
      { montant: 50000, payerDeviceFingerprint: "device-a", payeeDeviceFingerprint: "device-b" },
      { montant: 50000, payerDeviceFingerprint: "device-a", payeeDeviceFingerprint: "device-b" },
    ];
    expect(detectCollusionSuspicion(transactions)).toBe(false);
  });

  it("does not flag below the minimum count of round transactions", () => {
    const transactions = [
      { montant: 50000, payerDeviceFingerprint: "device-abc", payeeDeviceFingerprint: "device-abc" },
    ];
    expect(detectCollusionSuspicion(transactions)).toBe(false);
  });
});
