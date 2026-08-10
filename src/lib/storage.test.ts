import { describe, expect, it, beforeAll } from "vitest";
import { signKycDocToken, verifyKycDocToken } from "./storage";

beforeAll(() => {
  process.env.AUTH_SECRET = "test-secret";
});

describe("signed KYC document URLs (US-102 — jamais de bucket public)", () => {
  it("verifies a token it just signed", () => {
    const token = signKycDocToken("doc-123");
    const result = verifyKycDocToken(token);
    expect(result).toEqual({ docId: "doc-123" });
  });

  it("rejects a tampered token", () => {
    const token = signKycDocToken("doc-123");
    const tampered = token.slice(0, -2) + "zz";
    expect(verifyKycDocToken(tampered)).toBeNull();
  });

  it("rejects an expired token", () => {
    const originalNow = Date.now;
    Date.now = () => new Date("2026-01-01T00:00:00Z").getTime();
    const token = signKycDocToken("doc-123");
    Date.now = () => new Date("2026-01-01T00:10:00Z").getTime(); // +10min > TTL 5min
    expect(verifyKycDocToken(token)).toBeNull();
    Date.now = originalNow;
  });
});
