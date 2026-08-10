import { describe, expect, it } from "vitest";
import { containsLeakageAttempt } from "./leakage-detection";

describe("containsLeakageAttempt (US-1301)", () => {
  it("flags a phone number", () => {
    expect(containsLeakageAttempt("Appelle-moi au +225 07 12 34 56 78")).toBe(true);
  });

  it("flags a direct payment mention", () => {
    expect(containsLeakageAttempt("Envoie-moi ça par Orange Money direct")).toBe(true);
  });

  it("lets ordinary mission conversation through", () => {
    expect(containsLeakageAttempt("Le livrable sera prêt demain matin")).toBe(false);
  });
});
