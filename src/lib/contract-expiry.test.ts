import { describe, expect, it } from "vitest";
import {
  COUNTER_SIGN_DEADLINE_HOURS,
  counterSignDeadline,
  isCounterSignExpired,
} from "@/lib/contract-expiry";

const HOUR = 3_600_000;

describe("contract-expiry — délai de contre-signature (48h)", () => {
  it("calcule l'échéance à providerSignedAt + 48h", () => {
    const signed = new Date("2026-08-30T12:00:00.000Z");
    const deadline = counterSignDeadline(signed);
    expect(deadline.getTime() - signed.getTime()).toBe(COUNTER_SIGN_DEADLINE_HOURS * HOUR);
  });

  it("n'est pas expiré dans le délai", () => {
    const providerSignedAt = new Date(Date.now() - 10 * HOUR);
    expect(isCounterSignExpired({ providerSignedAt, clientSignedAt: null })).toBe(false);
  });

  it("est expiré après 48h sans contre-signature du client", () => {
    const providerSignedAt = new Date(Date.now() - 49 * HOUR);
    expect(isCounterSignExpired({ providerSignedAt, clientSignedAt: null })).toBe(true);
  });

  it("n'est pas expiré si le client a contre-signé", () => {
    const providerSignedAt = new Date(Date.now() - 100 * HOUR);
    expect(isCounterSignExpired({ providerSignedAt, clientSignedAt: new Date() })).toBe(false);
  });

  it("n'est pas expiré si le prestataire n'a pas encore signé", () => {
    expect(isCounterSignExpired({ providerSignedAt: null, clientSignedAt: null })).toBe(false);
  });
});
