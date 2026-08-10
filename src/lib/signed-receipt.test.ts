import { describe, expect, it, beforeAll } from "vitest";
import { signReceiptPayload, verifyReceiptSignature } from "./signed-receipt";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
});

describe("signed validation receipt (US-1304)", () => {
  const payload = { jalonId: "j1", validatedAt: "2026-01-01T00:00:00Z" };

  it("verifies a signature it just produced", () => {
    const signature = signReceiptPayload(payload);
    expect(verifyReceiptSignature(payload, signature)).toBe(true);
  });

  it("rejects a signature if the payload was altered (chargeback dispute scenario)", () => {
    const signature = signReceiptPayload(payload);
    expect(verifyReceiptSignature({ ...payload, jalonId: "j2" }, signature)).toBe(false);
  });

  it("rejects a garbage signature of different length", () => {
    expect(verifyReceiptSignature(payload, "not-a-real-signature")).toBe(false);
  });
});
