import { describe, expect, it } from "vitest";
import { hashIdNumber } from "./dedupe";

describe("hashIdNumber (US-1308 — anti-doublon de compte)", () => {
  it("produces the same hash regardless of case or surrounding whitespace", () => {
    expect(hashIdNumber("ab123456")).toBe(hashIdNumber(" AB123456 "));
  });

  it("produces different hashes for different id numbers", () => {
    expect(hashIdNumber("AB123456")).not.toBe(hashIdNumber("AB123457"));
  });
});
