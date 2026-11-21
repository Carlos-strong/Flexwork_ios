import { describe, it, expect } from "vitest";
import { isProposalEngaged, isGigOrderEngaged } from "./messaging-visibility";

describe("isProposalEngaged", () => {
  it("ouvre la discussion dès la candidature soumise", () => {
    expect(isProposalEngaged("envoyee")).toBe(true);
  });

  it("la maintient pendant toute la négociation", () => {
    expect(isProposalEngaged("preselectionnee")).toBe(true);
    expect(isProposalEngaged("en_negociation")).toBe(true);
    expect(isProposalEngaged("devis_valide")).toBe(true);
  });

  it("la maintient après acceptation (coordination de l'exécution)", () => {
    expect(isProposalEngaged("acceptee")).toBe(true);
  });

  it("la ferme quand la relation est éteinte", () => {
    expect(isProposalEngaged("refusee")).toBe(false);
    expect(isProposalEngaged("annulee_definitive")).toBe(false);
  });

  it("reste fermée sur un statut inconnu (défaut sûr)", () => {
    expect(isProposalEngaged("")).toBe(false);
    expect(isProposalEngaged("brouillon")).toBe(false);
  });
});

describe("isGigOrderEngaged", () => {
  it("ouvre la discussion dès la commande créée", () => {
    expect(isGigOrderEngaged("created")).toBe(true);
    expect(isGigOrderEngaged("client_signed")).toBe(true);
    expect(isGigOrderEngaged("active")).toBe(true);
    expect(isGigOrderEngaged("completed")).toBe(true);
  });

  it("la ferme sur une commande morte", () => {
    expect(isGigOrderEngaged("cancelled")).toBe(false);
    expect(isGigOrderEngaged("refunded")).toBe(false);
  });
});
