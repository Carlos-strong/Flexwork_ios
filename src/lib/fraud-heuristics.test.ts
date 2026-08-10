import { describe, expect, it } from "vitest";
import { detectMutualReviewSuspicion } from "./fraud-heuristics";

describe("detectMutualReviewSuspicion", () => {
  it("flags 3+ consecutive missions with mutual high ratings", () => {
    const pairs = [
      { authorToTarget: 5, targetToAuthor: 5 },
      { authorToTarget: 4, targetToAuthor: 4 },
      { authorToTarget: 5, targetToAuthor: 4 },
    ];
    expect(detectMutualReviewSuspicion(pairs)).toBe(true);
  });

  it("does not flag when fewer than the threshold of missions exist", () => {
    const pairs = [{ authorToTarget: 5, targetToAuthor: 5 }];
    expect(detectMutualReviewSuspicion(pairs)).toBe(false);
  });

  it("does not flag when one rating in the recent window is below the threshold", () => {
    const pairs = [
      { authorToTarget: 5, targetToAuthor: 5 },
      { authorToTarget: 2, targetToAuthor: 5 },
      { authorToTarget: 5, targetToAuthor: 4 },
    ];
    expect(detectMutualReviewSuspicion(pairs)).toBe(false);
  });
});
