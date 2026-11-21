import { describe, expect, it } from "vitest";
import { canAttachLivrable, canSubmitDeliverable, isAboveProgressFloor } from "./attachments";

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

describe("canSubmitDeliverable — jamais avant le séquestre (A-2)", () => {
  it("refuse contrat_signe : les fonds ne sont pas encore sécurisés", () => {
    expect(canSubmitDeliverable("contrat_signe")).toBe(false);
    expect(canSubmitDeliverable("proposition_acceptee")).toBe(false);
    expect(canSubmitDeliverable("contrat_genere")).toBe(false);
  });

  it("autorise une fois les fonds sous séquestre, pendant l'exécution et en re-soumission", () => {
    expect(canSubmitDeliverable("fonds_sous_sequestre")).toBe(true);
    expect(canSubmitDeliverable("en_cours")).toBe(true);
    expect(canSubmitDeliverable("livrable_soumis")).toBe(true);
  });

  it("refuse une mission déjà validée ou clôturée", () => {
    expect(canSubmitDeliverable("validee")).toBe(false);
    expect(canSubmitDeliverable("cloturee")).toBe(false);
  });
});

describe("isAboveProgressFloor", () => {
  it("accepte une proposition au moins égale à la dernière progression validée", () => {
    expect(isAboveProgressFloor(65, 65)).toBe(true);
    expect(isAboveProgressFloor(100, 65)).toBe(true);
  });

  it("refuse une proposition en dessous de la dernière progression validée", () => {
    expect(isAboveProgressFloor(64, 65)).toBe(false);
    expect(isAboveProgressFloor(0, 65)).toBe(false);
  });
});
