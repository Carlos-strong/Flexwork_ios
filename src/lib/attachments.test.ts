import { describe, expect, it } from "vitest";
import { canAttachLivrable } from "./attachments";

describe("canAttachLivrable (anti travail-test gratuit)", () => {
  it("refuses attachments before a proposal is accepted", () => {
    expect(canAttachLivrable("brouillon")).toBe(false);
    expect(canAttachLivrable("publiee")).toBe(false);
  });

  it("allows attachments once a proposal is accepted", () => {
    expect(canAttachLivrable("proposition_acceptee")).toBe(true);
    expect(canAttachLivrable("en_cours")).toBe(true);
  });
});
