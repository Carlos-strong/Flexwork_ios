import { describe, expect, it } from "vitest";
import { computeChainedHash, verifyChainIntegrity } from "./hash-chain";

describe("computeChainedHash", () => {
  it("is deterministic for the same input", () => {
    const a = computeChainedHash(null, { foo: "bar" });
    const b = computeChainedHash(null, { foo: "bar" });
    expect(a).toBe(b);
  });

  it("changes when the previous hash changes", () => {
    const a = computeChainedHash(null, { foo: "bar" });
    const b = computeChainedHash("some-other-hash", { foo: "bar" });
    expect(a).not.toBe(b);
  });

  it("changes when the payload changes", () => {
    const a = computeChainedHash(null, { foo: "bar" });
    const b = computeChainedHash(null, { foo: "baz" });
    expect(a).not.toBe(b);
  });
});

describe("verifyChainIntegrity (append-only, US-303/804)", () => {
  it("accepts a correctly chained sequence", () => {
    const p1 = { event: "created" };
    const h1 = computeChainedHash(null, p1);
    const p2 = { event: "updated" };
    const h2 = computeChainedHash(h1, p2);

    const chain = [
      { previousHash: null, currentHash: h1, payload: p1 },
      { previousHash: h1, currentHash: h2, payload: p2 },
    ];

    expect(verifyChainIntegrity(chain)).toBe(true);
  });

  it("rejects a chain with a tampered payload", () => {
    const p1 = { event: "created" };
    const h1 = computeChainedHash(null, p1);

    const chain = [{ previousHash: null, currentHash: h1, payload: { event: "tampered" } }];

    expect(verifyChainIntegrity(chain)).toBe(false);
  });

  it("rejects a chain with a broken link (wrong previousHash)", () => {
    const p1 = { event: "created" };
    const h1 = computeChainedHash(null, p1);
    const p2 = { event: "updated" };
    const h2 = computeChainedHash(h1, p2);

    const chain = [
      { previousHash: null, currentHash: h1, payload: p1 },
      { previousHash: "wrong-previous", currentHash: h2, payload: p2 },
    ];

    expect(verifyChainIntegrity(chain)).toBe(false);
  });

  it("accepts an empty chain", () => {
    expect(verifyChainIntegrity([])).toBe(true);
  });
});
