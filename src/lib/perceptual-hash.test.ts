import { describe, expect, it } from "vitest";
import { computePerceptualHash, hammingDistance, isLikelyDuplicatePhoto } from "./perceptual-hash";

describe("computePerceptualHash / hammingDistance (US-1307)", () => {
  it("produces identical hashes for identical file contents", () => {
    const buf = Buffer.from("photo de chantier");
    expect(computePerceptualHash(buf)).toBe(computePerceptualHash(Buffer.from("photo de chantier")));
  });

  it("has zero Hamming distance between identical hashes", () => {
    const hash = computePerceptualHash(Buffer.from("photo A"));
    expect(hammingDistance(hash, hash)).toBe(0);
  });

  it("has a non-zero Hamming distance between different photos", () => {
    const hashA = computePerceptualHash(Buffer.from("photo A"));
    const hashB = computePerceptualHash(Buffer.from("photo totalement différente"));
    expect(hammingDistance(hashA, hashB)).toBeGreaterThan(0);
  });
});

describe("isLikelyDuplicatePhoto (US-1307)", () => {
  it("flags an exact re-upload of an existing photo", () => {
    const hash = computePerceptualHash(Buffer.from("photo recyclée"));
    expect(isLikelyDuplicatePhoto(hash, [hash])).toBe(true);
  });

  it("does not flag a genuinely new photo", () => {
    const existing = computePerceptualHash(Buffer.from("photo existante"));
    const fresh = computePerceptualHash(Buffer.from("photo toute nouvelle et différente"));
    expect(isLikelyDuplicatePhoto(fresh, [existing])).toBe(false);
  });
});
